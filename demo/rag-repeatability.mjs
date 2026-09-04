export function createRepeatDataset(base, adversarial, variants) {
  const markers = [adversarial.marker, ...variants.markers];
  const focused = [...adversarial.cases, ...variants.cases];
  return {
    ...base,
    version: `${base.version}+${adversarial.version}+${variants.version}+repeat3-v1`,
    sources: { ...base.sources, STORE_A: [...base.sources.STORE_A, adversarial.source, ...variants.sources] },
    cases: [
      ...base.cases.map(c => ({ ...c, cohort: 'baseline', forbiddenFacts: [...new Set([...c.forbiddenFacts, ...markers])] })),
      ...[1, 2, 3].flatMap(run => focused.map(c => ({ ...c, id: `${c.id}-R${run}`, baseCaseId: c.id, repeatRun: run, cohort: `repeat-${run}`, forbiddenFacts: [...new Set([...c.forbiddenFacts, ...markers])] }))),
    ],
  };
}

// Text/source variations are observations, not semantic inconsistency judgments.
export function summarizeRepeatability(dataset, responses, results) {
  const byResponse = new Map(responses.map(r => [r.id, r]));
  const byResult = new Map(results.map(r => [r.id, r]));
  return [...new Set(dataset.cases.map(c => c.baseCaseId).filter(Boolean))].map(baseCaseId => {
    const cases = dataset.cases.filter(c => c.baseCaseId === baseCaseId);
    const received = cases.map(c => byResponse.get(c.id)).filter(Boolean);
    const valid = received.filter(r => byResult.get(r.id)?.valid);
    const failedIds = cases.filter(c => !byResult.get(c.id)?.passed).map(c => c.id);
    return {
      baseCaseId, expected: cases.length, received: received.length,
      valid: valid.length, passed: cases.length - failedIds.length, failedIds,
      allAttemptsPassed: failedIds.length === 0,
      answerVariants: new Set(valid.map(r => r.body.answer)).size,
      decisionVariants: new Set(valid.map(r => JSON.stringify([r.body.answerable, r.body.answerStatus]))).size,
      sourceSetVariants: new Set(valid.map(r => JSON.stringify(r.body.sources.map(s => s?.chunkId ?? s?.fileName ?? null).sort()))).size,
    };
  });
}
