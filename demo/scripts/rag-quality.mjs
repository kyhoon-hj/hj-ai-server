import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { evaluateDataset, validateDataset } from '../rag-quality.mjs';
import { createRepeatDataset, summarizeRepeatability } from '../rag-repeatability.mjs';

const datasetUrl = new URL('../fixtures/rag-golden.json', import.meta.url);
let datasetText = await readFile(datasetUrl, 'utf8');
const variant = process.env.RAG_EVAL_DATASET ?? 'golden';
if (!['golden', 'extended', 'adversarial', 'repeatability'].includes(variant)) throw new Error('Unknown dataset variant');
if (variant === 'repeatability') {
  datasetText = JSON.stringify(createRepeatDataset(JSON.parse(datasetText), JSON.parse(await readFile(new URL('../fixtures/rag-adversarial.json', import.meta.url), 'utf8')), JSON.parse(await readFile(new URL('../fixtures/rag-attack-variants.json', import.meta.url), 'utf8'))));
}
if (variant === 'adversarial') {
  const base = JSON.parse(datasetText);
  const extra = JSON.parse(await readFile(new URL('../fixtures/rag-adversarial.json', import.meta.url), 'utf8'));
  datasetText = JSON.stringify({ ...base, version: `${base.version}+${extra.version}`, sources: { ...base.sources, STORE_A: [...base.sources.STORE_A, extra.source] }, cases: [...base.cases.map(c => ({ ...c, cohort: 'baseline', forbiddenFacts: [...c.forbiddenFacts, extra.marker] })), ...extra.cases.map(c => ({ ...c, cohort: 'adversarial' }))] });
}
if (variant === 'extended') {
  const base = JSON.parse(datasetText);
  const extension = JSON.parse(await readFile(new URL('../fixtures/rag-expansion.json', import.meta.url), 'utf8'));
  datasetText = JSON.stringify({ ...base, version: `${base.version}+${extension.version}`, cases: [...base.cases.map(c => ({ ...c, cohort: 'baseline' })), ...extension.cases.map(c => ({ ...c, cohort: 'expansion' }))] });
}
const dataset = validateDataset(JSON.parse(datasetText));
const corpus = process.env.RAG_EVAL_CORPUS ?? 'original';
if (!['original', 'quality-v2'].includes(corpus)) throw new Error('Unknown corpus variant');
if (corpus === 'quality-v2') dataset.fixtureVersion = 'quality-text-2.0.0';
if (variant === 'adversarial') {
  if (corpus !== 'quality-v2') throw new Error('Adversarial evaluation requires quality-v2 corpus');
  dataset.fixtureVersion = 'quality-text-2.0.0+inspection-1.0.0';
}
const digest = text => createHash('sha256').update(text).digest('hex');
if (variant === 'repeatability') {
  if (corpus !== 'quality-v2') throw new Error('Repeatability evaluation requires quality-v2 corpus');
  dataset.fixtureVersion = 'quality-text-2.0.0+inspection-1.0.0+attack-variants-1.0.0';
}
const fixtures = {};
for (const name of new Set(Object.values(dataset.sources).flat())) {
  fixtures[name] = await readFile(new URL(`../fixtures/${corpus === 'quality-v2' ? 'quality-v2/' : ''}${name}`, import.meta.url), 'utf8');
}
for (const c of dataset.cases.filter(c => c.expectedAnswerable)) {
  if (!c.expectedSources.some(name => fixtures[name].includes(c.evidence))) throw new Error(`Evidence does not match fixture: ${c.id}`);
  for (const span of c.evidenceSpans ?? []) {
    if (!c.expectedSources.includes(span.fileName) || !fixtures[span.fileName]?.includes(span.text)) throw new Error(`Composite evidence does not match fixture: ${c.id}`);
  }
}
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--validate') {
  console.log(JSON.stringify({ mode: 'DATASET_VALIDATION_ONLY', cases: dataset.cases.length, answerable: dataset.cases.filter(c => c.expectedAnswerable).length, noAnswer: dataset.cases.filter(c => !c.expectedAnswerable).length, critical: dataset.cases.filter(c => c.critical).length, valid: true }));
} else {
  let responses;
  const startedAt = new Date().toISOString();
  if (args[0] === '--answers' && args.length === 2) {
    responses = JSON.parse(await readFile(args[1], 'utf8'));
  } else if (args[0] === '--live' && args.length === 1) {
    const base = new URL(process.env.RAG_EVAL_BASE_URL ?? 'http://127.0.0.1:11000');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || !['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Live evaluator requires an explicit local test server');
    const keys = Object.fromEntries(Object.keys(dataset.sources).map(tenant => [tenant, process.env[`RAG_EVAL_APPKEY_${tenant}`]]));
    if (Object.values(keys).some(key => !key) || new Set(Object.values(keys)).size !== Object.keys(keys).length) throw new Error('Distinct test tenant appkeys are required');
    const url = path => `${base.toString().replace(/\/$/, '')}${path}`;
    // Fail closed if the corpus is missing, mixed with other documents, or not published.
    for (const [tenant, key] of Object.entries(keys)) {
      const response = await fetch(url('/knowledge/files'), { headers: { appkey: key }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`Fixture preflight HTTP ${response.status}: ${tenant}`);
      const files = await response.json();
      if (!Array.isArray(files) || files.length !== dataset.sources[tenant].length || files.some(f => !dataset.sources[tenant].includes(f.originalName) || f.status !== 'indexed' || f.accessLevel !== 'PUBLIC' || f.businessStatus !== 'PUBLISHED' || f.checksum !== digest(fixtures[f.originalName])) || new Set(files.map(f => f.originalName)).size !== files.length) throw new Error(`Exact indexed fixture corpus required: ${tenant}`);
    }
    responses = [];
    const diagnostics = [];
    let failures = 0;
    for (const c of dataset.cases) {
      if (failures >= 3) break;
      const start = Date.now();
      // Read-only candidate scores under identical tenant/policy filters; does not alter answers.
      if (process.env.RAG_EVAL_REPORT_DIRECTORY) {
        const diagnostic = await fetch(url('/knowledge/search'), { method: 'POST', headers: { 'content-type': 'application/json', appkey: keys[c.tenant] }, body: JSON.stringify({ query: c.query, limit: 5, scoreThreshold: -1, filters: { accessLevels: ['PUBLIC'], businessStatuses: ['PUBLISHED'] } }), signal: AbortSignal.timeout(45000) });
        const payload = diagnostic.ok ? await diagnostic.json() : null;
        diagnostics.push({ id: c.id, status: diagnostic.status, matches: payload?.matches?.map(m => ({ fileName: m.fileName, score: m.score, content: m.content })) ?? [] });
        await writeFile(join(process.env.RAG_EVAL_REPORT_DIRECTORY, 'retrieval-diagnostics.json'), JSON.stringify(diagnostics, null, 2), { mode: 0o600 });
      }
      let record;
      try {
        const response = await fetch(url('/knowledge/answers'), {
          method: 'POST', headers: { 'content-type': 'application/json', appkey: keys[c.tenant], 'x-correlation-id': randomUUID() },
          body: JSON.stringify({ query: c.query, strict: true, includeSources: true, includeSourceContent: Boolean(c.requiredExposureMarker), maxTokens: 256, temperature: 0, limit: 5, scoreThreshold: 0.35, filters: { accessLevels: ['PUBLIC'], businessStatuses: ['PUBLISHED'] } }),
          signal: AbortSignal.timeout(45000),
        });
        record = { id: c.id, status: response.status, body: response.ok ? await response.json() : null, latencyMs: Date.now() - start };
      } catch { record = { id: c.id, status: 0, body: null, latencyMs: Date.now() - start }; }
      if (record.status !== 200) failures++;
      responses.push(record);
      if (process.env.RAG_EVAL_REPORT_DIRECTORY) await writeFile(join(process.env.RAG_EVAL_REPORT_DIRECTORY, 'responses.json'), JSON.stringify(responses, null, 2), { mode: 0o600 });
      console.error(`${c.id}: HTTP ${record.status}`);
    }
  } else throw new Error('Use --validate, --answers <responses.json>, or --live');
  const report = evaluateDataset(dataset, responses);
  report.repeatability = summarizeRepeatability(dataset, responses, report.results);
  report.cohorts = Object.fromEntries([...new Set(dataset.cases.map(c => c.cohort ?? 'baseline'))].map(cohort => {
    const ids = new Set(dataset.cases.filter(c => (c.cohort ?? 'baseline') === cohort).map(c => c.id));
    const rows = report.results.filter(r => ids.has(r.id));
    return [cohort, { total: rows.length, passed: rows.filter(r => r.passed).length, failedIds: rows.filter(r => !r.passed).map(r => r.id) }];
  }));
  let commit = 'unavailable';
  let workingTreeDirty = null;
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* Optional provenance. */ }
  try { workingTreeDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0; } catch { /* Optional provenance. */ }
  console.log(JSON.stringify({ ...report, mode: args[0] === '--live' ? 'LIVE_LOCAL_API' : 'OFFLINE_RESPONSES', startedAt, finishedAt: new Date().toISOString(), commit, workingTreeDirty, serverRevisionVerified: false, scorerSha256: digest(await readFile(new URL('../rag-quality.mjs', import.meta.url), 'utf8')), datasetSha256: digest(datasetText), fixtureSha256: Object.fromEntries(Object.entries(fixtures).map(([name, text]) => [name, digest(text)])), parameters: args[0] === '--live' ? { maxTokens: 256, temperature: 0, scoreThreshold: 0.35, limit: 5 } : null }, null, 2));
  if (!report.gatePassed) process.exitCode = 1;
}
