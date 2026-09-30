import { describe, it, expect } from 'vitest';
import { PULSE, monthChange, averageMove, heat, formatMove, parseWatchlist, toggleWatch, WATCHLIST_CAP, type MarketQuote } from './markets';

const q = (symbol: string, change_percent: number): MarketQuote => ({ name: symbol, symbol, price: 1, change_percent, up: change_percent >= 0 });

describe('PULSE', () => {
  it('names eight distinct benchmarks', () => {
    expect(PULSE).toHaveLength(8);
    expect(new Set(PULSE.map(p => p.symbol)).size).toBe(8);
  });
});

describe('monthChange', () => {
  it('measures first close to last', () => {
    expect(monthChange([100, 90, 110])).toBeCloseTo(10);
  });
  it('has no reading without two usable closes', () => {
    expect(monthChange(undefined)).toBeNull();
    expect(monthChange([5])).toBeNull();
    expect(monthChange([0, 5])).toBeNull();
  });
});

describe('averageMove', () => {
  it('averages the moves it can read', () => {
    expect(averageMove([q('A', 2), q('B', -1), q('C', NaN)])).toBeCloseTo(0.5);
    expect(averageMove([])).toBeNull();
  });
});

describe('heat', () => {
  it('colours direction and saturates at the cap', () => {
    expect(heat(1).background).toContain('0,230,118');
    expect(heat(-1).background).toContain('255,61,61');
    expect(heat(3)).toEqual(heat(12));
    expect(heat(0.1).background).not.toEqual(heat(2).background);
  });
  it('treats a missing reading as flat', () => {
    expect(heat(NaN).background).toContain('0.050');
  });
});

describe('formatMove', () => {
  it('signs moves with a real minus and has no negative zero', () => {
    expect(formatMove(1.234)).toBe('+1.23%');
    expect(formatMove(-0.4)).toBe('−0.40%');
    expect(formatMove(-0.001)).toBe('0.00%');
    expect(formatMove(null)).toBe('—');
  });
});

describe('watchlist', () => {
  it('survives missing, corrupt and foreign stored values', () => {
    expect(parseWatchlist(null)).toEqual([]);
    expect(parseWatchlist('nope')).toEqual([]);
    expect(parseWatchlist('{"a":1}')).toEqual([]);
    expect(parseWatchlist(JSON.stringify(['^VIX', 'ES=F', '<script>', 'ES=F', 7]))).toEqual(['^VIX', 'ES=F']);
  });

  it('toggles, keeps order, and caps the list', () => {
    expect(toggleWatch(['A'], 'B')).toEqual(['A', 'B']);
    expect(toggleWatch(['A', 'B'], 'A')).toEqual(['B']);
    expect(toggleWatch([], 'bad symbol!')).toEqual([]);
    const full = Array.from({ length: WATCHLIST_CAP }, (_, i) => `S${i}`);
    expect(toggleWatch(full, 'NEW')).toHaveLength(WATCHLIST_CAP);
  });
});
