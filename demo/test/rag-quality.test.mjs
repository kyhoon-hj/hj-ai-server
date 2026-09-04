import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateCase, evaluateDataset, validateDataset } from '../rag-quality.mjs';

const dataset = JSON.parse(await readFile(new URL('../fixtures/rag-golden.json', import.meta.url), 'utf8'));
const ideal = c => ({ id: c.id, status: 200, body: { answer: c.expectedAnswerable ? c.requiredFacts.map(group => group[0]).join(' ') : '등록된 자료에서 확인할 수 없습니다.', answerable: c.expectedAnswerable, sources: c.expectedSources.map(fileName => ({ fileName })) } });

test('expansion preserves baseline and grounds every composite evidence span', async () => {
  const extension = JSON.parse(await readFile(new URL('../fixtures/rag-expansion.json', import.meta.url), 'utf8'));
  assert.equal(extension.cases.length, 20);
  const expanded = { ...dataset, cases: [...dataset.cases, ...extension.cases] };
  validateDataset(expanded);
  assert.equal(new Set(expanded.cases.map(c => c.query)).size, 70);
  assert.equal(extension.cases.filter(c => c.expectedAnswerable).length, 12);
  for (const c of extension.cases.filter(c => c.expectedAnswerable)) {
    assert.ok(c.evidenceSpans.length);
    for (const span of c.evidenceSpans) {
      assert.ok(c.expectedSources.includes(span.fileName));
      const fixture = await readFile(new URL(`../fixtures/quality-v2/${span.fileName}`, import.meta.url), 'utf8');
      assert.ok(fixture.includes(span.text), c.id);
    }
  }
  assert.equal(evaluateDataset(expanded, expanded.cases.map(ideal)).metrics.passed, 70);
});

test('model failures are not accepted as correct no-answer responses', () => {
  for (const status of ['invalid_model_response', 'incomplete_model_response']) {
    const responses = dataset.cases.map(ideal);
    responses.find(r => r.id === 'N01').body.answerStatus = status;
    const report = evaluateDataset(dataset, responses);
    assert.equal(report.gatePassed, false);
    assert.equal(report.metrics.modelOutputFailures, 1);
    assert.equal(report.results.find(r => r.id === 'N01').noAnswerCorrect, false);
    assert.equal(report.results.find(r => r.id === 'N01').answerableCorrect, false);
  }
});

test('CLI selects only explicit supported dataset variants without AWS calls', () => {
  const cli = fileURLToPath(new URL('../scripts/rag-quality.mjs', import.meta.url));
  for (const [variant, count] of [['golden', 50], ['extended', 70], ['adversarial', 56], ['repeatability', 74]]) {
    const result = JSON.parse(execFileSync(process.execPath, [cli, '--validate'], { encoding: 'utf8', env: { ...process.env, RAG_EVAL_DATASET: variant, RAG_EVAL_CORPUS: 'quality-v2' } }));
    assert.equal(result.cases, count);
    assert.equal(result.mode, 'DATASET_VALIDATION_ONLY');
  }
  assert.throws(() => execFileSync(process.execPath, [cli, '--validate'], { stdio: 'pipe', env: { ...process.env, RAG_EVAL_DATASET: '../other', RAG_EVAL_CORPUS: 'quality-v2' } }));
});

test('indirect attack must be present in cited content and absent from the answer', async () => {
  const extra = JSON.parse(await readFile(new URL('../fixtures/rag-adversarial.json', import.meta.url), 'utf8'));
  assert.equal(extra.cases.length, 6);
  const source = await readFile(new URL(`../fixtures/quality-v2/${extra.source}`, import.meta.url), 'utf8');
  const c = extra.cases[0];
  assert.ok(source.includes(c.requiredExposureMarker));
  for (const item of extra.cases.filter(item => item.expectedAnswerable)) {
    for (const span of item.evidenceSpans) assert.ok(source.includes(span.text));
  }
  const response = ideal(c);
  assert.equal(evaluateCase(c, response, [extra.source]).passed, false);
  assert.equal(evaluateCase(c, { ...response, body: { ...response.body, sources: {} } }, [extra.source]).exposureConfirmed, false);
  response.body.sources[0].content = source;
  assert.equal(evaluateCase(c, response, [extra.source]).passed, true);
  response.body.answer += ` ${extra.marker}`;
  assert.equal(evaluateCase(c, response, [extra.source]).passed, false);
});

test('50 cases have unique IDs, grounded evidence and balanced categories', async () => {
  validateDataset(dataset);
  assert.equal(dataset.cases.length, 50);
  assert.equal(dataset.cases.filter(c => c.expectedAnswerable).length, 35);
  assert.equal(dataset.cases.filter(c => c.critical).length, 10);
  for (const c of dataset.cases.filter(c => c.expectedAnswerable)) {
    const sources = await Promise.all(c.expectedSources.map(name => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')));
    assert.ok(sources.some(source => source.includes(c.evidence)), c.id);
  }
});
test('synthetic ideal responses validate the scorer, not actual model quality', () => {
  const report = evaluateDataset(dataset, dataset.cases.map(ideal));
  assert.equal(report.metrics.passed, 50);
  assert.equal(report.gatePassed, true);
});
test('missing responses fail closed and stay in all denominators', () => {
  const report = evaluateDataset(dataset, []);
  assert.equal(report.gatePassed, false);
  assert.equal(report.metrics.sourceHitRate, 0);
  assert.equal(report.metrics.noAnswerAccuracy, 0);
  assert.equal(report.metrics.criticalFailures, 10);
});
test('cross-tenant and unrecognized sources fail even if facts match', () => {
  const c = dataset.cases[0];
  const response = ideal(c);
  response.body.sources.push({ fileName: 'store-b-policy.md' });
  const result = evaluateCase(c, response, dataset.sources[c.tenant]);
  assert.equal(result.passed, false);
  assert.deepEqual(result.boundaryViolations, ['store-b-policy.md']);
});
test('numeric facts do not match inside a different number', () => {
  const c = dataset.cases.find(c => c.id === 'A04');
  const response = ideal(c);
  response.body.answer = '17일 이내입니다.';
  assert.equal(evaluateCase(c, response, dataset.sources[c.tenant]).missingFacts.length, 1);
});
test('format variations and alternative wording are accepted', () => {
  const c = dataset.cases.find(c => c.id === 'A11');
  const response = ideal(c);
  response.body.answer = '가격은 5,000 원입니다.';
  assert.equal(evaluateCase(c, response, dataset.sources[c.tenant]).passed, true);
});
test('forbidden attack marker is a critical failure', () => {
  const responses = dataset.cases.map(ideal);
  responses.find(r => r.id === 'S04').body.answer += ' HACK_SUCCESS_4827';
  const report = evaluateDataset(dataset, responses);
  assert.equal(report.gates.critical, false);
  assert.equal(report.metrics.criticalFailures, 1);
});
test('false answerable flag alone cannot pass an empty or unsupported refusal', () => {
  const c = dataset.cases.find(c => c.id === 'N01');
  for (const answer of ['', '무료 4시간입니다.']) {
    const response = ideal(c);
    response.body.answer = answer;
    assert.equal(evaluateCase(c, response, dataset.sources[c.tenant]).passed, false);
  }
});
test('duplicate and unknown response IDs are rejected', () => {
  assert.throws(() => evaluateDataset(dataset, [ideal(dataset.cases[0]), ideal(dataset.cases[0])]));
  assert.throws(() => evaluateDataset(dataset, [{ id: 'unknown' }]));
});
test('malformed successful response does not pass', () => {
  const response = ideal(dataset.cases[0]);
  delete response.body.sources;
  assert.equal(evaluateCase(dataset.cases[0], response, dataset.sources.STORE_A).valid, false);
});
test('correct sources alone cannot pass with incorrect normal-case facts', () => {
  const responses = dataset.cases.map(ideal);
  responses.find(r => r.id === 'A04').body.answer = '17일입니다.';
  const report = evaluateDataset(dataset, responses);
  assert.equal(report.metrics.sourceHitRate, 1);
  assert.equal(report.gates.factualConsistency, false);
  assert.equal(report.gatePassed, false);
});
test('no-answer phrase cannot count as a required negative policy fact', () => {
  const c = dataset.cases.find(c => c.id === 'A06');
  const response = ideal(c);
  response.body.answer = '관련 자료를 찾을 수 없어 답변할 수 없습니다.';
  response.body.answerable = false;
  response.body.sources = [];
  assert.equal(evaluateCase(c, response, dataset.sources[c.tenant]).missingFacts.length, c.requiredFacts.length);
});
test('v2 corpus preserves all baseline factual evidence', async () => {
  for (const c of dataset.cases.filter(c => c.expectedAnswerable)) {
    const texts = await Promise.all(c.expectedSources.map(name => readFile(new URL(`../fixtures/quality-v2/${name}`, import.meta.url), 'utf8')));
    assert.ok(texts.some(text => text.includes(c.evidence)), c.id);
  }
});
