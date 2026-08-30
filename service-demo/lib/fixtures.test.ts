import { describe, expect, it } from 'vitest';
import { journeys, personas, policyFixtures, products, storeFixture } from './fixtures';

describe('non-PII service-demo fixtures', () => {
  it('uses stable, unique fixture IDs', () => { const ids = [storeFixture.id, ...journeys.map(({ id }) => id), ...products.map(({ id }) => id), ...policyFixtures.map(({ id }) => id)]; expect(new Set(ids).size).toBe(ids.length); expect(ids.every((id) => /^[A-Z]+(?:_[A-Z0-9]+)+$/.test(id))).toBe(true); });
  it('covers every persona with two representative journeys', () => { for (const persona of personas) expect(journeys.filter(({ personaId }) => personaId === persona.id)).toHaveLength(2); });
  it('contains only explicit fictional persona labels', () => expect(personas.map(({ label }) => label)).toEqual(['고객 01', '상담원 A', '매장 관리자']));
});
