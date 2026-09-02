import { describe, expect, it } from 'vitest';
import { canConnect } from '../modules/ports';

describe('port compatibility', () => {
  it('accepts identical types', () => {
    expect(canConnect('pair', 'pair')).toBe(true);
    expect(canConnect('wallet', 'wallet')).toBe(true);
  });

  it('rejects unrelated types', () => {
    expect(canConnect('pair', 'wallet')).toBe(false);
    expect(canConnect('token', 'quote')).toBe(false);
  });

  it('allows declared coercions in one direction only', () => {
    expect(canConnect('price', 'number')).toBe(true);
    expect(canConnect('balance', 'amount')).toBe(true);
    expect(canConnect('number', 'amount')).toBe(true);
    expect(canConnect('pair', 'number')).toBe(false);
  });

  it('treats any as a wildcard on both sides', () => {
    expect(canConnect('any', 'transaction')).toBe(true);
    expect(canConnect('signal', 'any')).toBe(true);
  });
});
