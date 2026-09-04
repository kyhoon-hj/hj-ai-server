import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRepeatDataset, summarizeRepeatability } from '../rag-repeatability.mjs';
import { evaluateDataset, validateDataset } from '../rag-quality.mjs';

const load = async name => JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
const base = await load('rag-golden.json');
const oldAttack = await load('rag-adversarial.json');
const variants = await load('rag-attack-variants.json');
const dataset = createRepeatDataset(base, oldAttack, variants);
const ideal = c => ({ id: c.id, status: 200, body: { answer: c.expectedAnswerable ? c.requiredFacts.map(g => g[0]).join(' ') : '자료에서 확인할 수 없습니다.', answerable: c.expectedAnswerable, answerStatus: c.expectedAnswerable ? 'answered' : 'insufficient_evidence', sources: c.expectedSources.map(fileName => ({ fileName, content: c.requiredExposureMarker ?? '' })) } });

test('repeat dataset has 50 baseline plus 8 identical questions across 3 rounds', async () => {
  validateDataset(dataset);
  assert.equal(dataset.cases.length, 74);
  assert.equal(base.cases.length, 50);
  assert.equal(base.sources.STORE_A.length, 2);
  for (const c of [...oldAttack.cases, ...variants.cases]) {
    const repeats = dataset.cases.filter(r => r.baseCaseId === c.id);
    assert.deepEqual(repeats.map(r => r.repeatRun), [1, 2, 3]);
    assert.ok(repeats.every(r => r.query === c.query));
    if (c.expectedAnswerable) {
      const source = await readFile(new URL(`../fixtures/quality-v2/${c.expectedSources[0]}`, import.meta.url), 'utf8');
      assert.ok(source.includes(c.evidence));
      if (c.requiredExposureMarker) assert.ok(source.includes(c.requiredExposureMarker));
    }
  }
  const answers = dataset.cases.map(ideal);
  const report = evaluateDataset(dataset, answers);
  assert.equal(report.gatePassed, true);
  assert.ok(summarizeRepeatability(dataset, answers, report.results).every(r => r.allAttemptsPassed && r.expected === 3));
});

test('a missing attempt cannot appear stable or fully passed', () => {
  const answers = dataset.cases.map(ideal).filter(r => r.id !== 'I01-R2');
  const report = evaluateDataset(dataset, answers);
  const row = summarizeRepeatability(dataset, answers, report.results).find(r => r.baseCaseId === 'I01');
  assert.equal(row.allAttemptsPassed, false);
  assert.equal(row.received, 2);
  assert.deepEqual(row.failedIds, ['I01-R2']);
});

test('wording changes are separate from decision changes and failures', () => {
  const answers = dataset.cases.map(ideal);
  answers.find(r => r.id === 'I01-R2').body.answer += ' 안내입니다.';
  const report = evaluateDataset(dataset, answers);
  const row = summarizeRepeatability(dataset, answers, report.results).find(r => r.baseCaseId === 'I01');
  assert.equal(row.allAttemptsPassed, true);
  assert.equal(row.answerVariants, 2);
  assert.equal(row.decisionVariants, 1);
  assert.equal(row.sourceSetVariants, 1);
  answers.find(r => r.id === 'I01-R3').body.answerStatus = 'invalid_model_response';
  const failed = evaluateDataset(dataset, answers);
  assert.equal(summarizeRepeatability(dataset, answers, failed.results)[0].allAttemptsPassed, false);
});
