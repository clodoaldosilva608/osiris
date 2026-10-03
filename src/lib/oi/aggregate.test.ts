import { describe, it, expect } from 'vitest';
import { pool, quantile, roundStat } from './aggregate';

describe('pool', () => {
  it('is symmetric about even odds', () => {
    expect(pool([{ probability: 0.2, confidence: 0.5 }, { probability: 0.8, confidence: 0.5 }])).toBeCloseTo(0.5);
  });

  it('stays inside the range the panel gave', () => {
    const p = pool([{ probability: 0.1, confidence: 1 }, { probability: 0.3, confidence: 0.2 }, { probability: 0.25, confidence: 0.6 }]);
    expect(p).toBeGreaterThan(0.1);
    expect(p).toBeLessThan(0.3);
  });

  it('listens to confidence', () => {
    const sure = pool([{ probability: 0.9, confidence: 1 }, { probability: 0.5, confidence: 0 }]);
    const unsure = pool([{ probability: 0.9, confidence: 0 }, { probability: 0.5, confidence: 1 }]);
    expect(sure).toBeGreaterThan(unsure);
  });

  it('copes with certainty and with nobody', () => {
    expect(Number.isFinite(pool([{ probability: 1, confidence: 1 }, { probability: 0, confidence: 1 }]))).toBe(true);
    expect(pool([])).toBeNaN();
  });
});

describe('roundStat', () => {
  it('reports the middle and the spread', () => {
    const s = roundStat(2, [0.1, 0.2, 0.3, 0.4, 0.95].map(probability => ({ probability, confidence: 0.5 })));
    expect(s).toMatchObject({ round: 2, n: 5, median: 0.3, p25: 0.2, p75: 0.4, min: 0.1, max: 0.95 });
    expect(s.spread).toBeCloseTo(0.2);
    expect(s.histogram).toEqual([0, 1, 1, 1, 1, 0, 0, 0, 0, 1]);
  });

  it('interpolates quantiles', () => {
    expect(quantile([0, 1], 0.25)).toBeCloseTo(0.25);
    expect(quantile([], 0.5)).toBeNaN();
  });
});
