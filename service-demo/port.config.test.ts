import { describe, expect, it } from 'vitest';
import { requireServiceDemoPort } from './port.config.mjs';

describe('service demo standard port', () => {
  it('defaults to 11002', () => expect(requireServiceDemoPort(undefined)).toBe(11002));
  it('accepts the standard port', () => expect(requireServiceDemoPort('11002')).toBe(11002));
  it('rejects a different port', () => expect(() => requireServiceDemoPort('3000')).toThrow(/11002/));
});
