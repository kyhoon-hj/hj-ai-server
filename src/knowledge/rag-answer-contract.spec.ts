import { parseRagAnswer } from './rag-answer-contract';

describe('RAG answer contract', () => {
  const parse = (value: unknown, count = 2, reason = 'end_turn') =>
    parseRagAnswer(
      JSON.stringify(value),
      count,
      '자료를 확인할 수 없습니다.',
      reason,
    );
  const valid = {
    answerable: true,
    answer: ' 오전 10시입니다. ',
    sourceIndexes: [2, 2],
  };

  it('validates references and preserves their original indexes', () => {
    expect(parse(valid)).toEqual({
      answerable: true,
      answer: '오전 10시입니다.',
      sourceIndexes: [2],
      answerStatus: 'answered',
    });
  });

  it('distinguishes insufficient evidence from retrieval presence', () => {
    expect(
      parse({ answerable: false, answer: 'untrusted text', sourceIndexes: [] }),
    ).toEqual({
      answerable: false,
      answer: '자료를 확인할 수 없습니다.',
      sourceIndexes: [],
      answerStatus: 'insufficient_evidence',
    });
  });

  it('preserves a cited partial answer and its explicit uncertainty', () => {
    const answer =
      '상품 위치에서 1층과 2층이 확인됩니다. 전체 층수와 평면도는 확인할 수 없습니다.';
    expect(parse({ answerable: true, answer, sourceIndexes: [1] })).toEqual({
      answerable: true,
      answer,
      sourceIndexes: [1],
      answerStatus: 'answered',
    });
    expect(
      parse({ answerable: true, answer, sourceIndexes: [] }).answerable,
    ).toBe(false);
  });

  it.each([
    null,
    [],
    {},
    { ...valid, answerable: 'true' },
    { ...valid, answer: '' },
    { ...valid, sourceIndexes: [] },
    { ...valid, sourceIndexes: [0] },
    { ...valid, sourceIndexes: [3] },
    { ...valid, sourceIndexes: [1.5] },
    { ...valid, sourceIndexes: ['1'] },
    { ...valid, sourceIndexes: null },
    { ...valid, answerable: false },
  ])('fails closed on invalid model contracts: %j', (value) => {
    expect(parse(value)).toMatchObject({
      answerable: false,
      sourceIndexes: [],
      answerStatus: 'invalid_model_response',
    });
  });

  it('rejects malformed JSON without exposing raw model output', () => {
    expect(
      parseRagAnswer('secret unfinished {', 2, 'fallback', 'end_turn'),
    ).toEqual({
      answerable: false,
      answer: 'fallback',
      sourceIndexes: [],
      answerStatus: 'invalid_model_response',
    });
  });

  it.each([
    'max_tokens',
    'guardrail_intervened',
    'content_filtered',
    'tool_use',
  ])('rejects incomplete or blocked output: %s', (reason) => {
    expect(parse(valid, 2, reason).answerStatus).toBe(
      'incomplete_model_response',
    );
  });

  it('requires a confirmed completion reason', () => {
    expect(
      parseRagAnswer(JSON.stringify(valid), 2, 'fallback').answerStatus,
    ).toBe('incomplete_model_response');
  });

  it('cannot claim grounded answerability without any references', () => {
    expect(parse(valid, 0).answerable).toBe(false);
  });
});
