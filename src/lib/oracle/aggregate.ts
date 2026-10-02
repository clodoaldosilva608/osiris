/**
 * Pooling the panel. The consensus is a confidence-weighted mean of the
 * agents' log-odds (a geometric pool of odds), which listens to a confident
 * minority more than a plain average does and never lands outside the range
 * the panel gave. The median and quartiles are reported beside it so a split
 * panel reads as split.
 */
import type { RoundStat } from './types';

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const bound = (p: number) => Math.min(0.99, Math.max(0.01, p));

/** The q-quantile of sorted values, interpolated. */
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function pool(views: { probability: number; confidence: number }[]): number {
  let num = 0;
  let den = 0;
  for (const v of views) {
    // A shrug still counts, a little.
    const w = 0.25 + Math.min(1, Math.max(0, v.confidence));
    num += w * logit(bound(v.probability));
    den += w;
  }
  return den ? sigmoid(num / den) : NaN;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function roundStat(round: number, views: { probability: number; confidence: number }[]): RoundStat {
  const ps = views.map(v => bound(v.probability)).sort((a, b) => a - b);
  const histogram = new Array(10).fill(0);
  for (const p of ps) histogram[Math.min(9, Math.floor(p * 10))]++;
  const p25 = quantile(ps, 0.25);
  const p75 = quantile(ps, 0.75);
  return {
    round,
    consensus: r3(pool(views)),
    median: r3(quantile(ps, 0.5)),
    mean: r3(ps.reduce((t, p) => t + p, 0) / (ps.length || 1)),
    p25: r3(p25),
    p75: r3(p75),
    min: r3(ps[0] ?? NaN),
    max: r3(ps[ps.length - 1] ?? NaN),
    spread: r3(p75 - p25),
    n: ps.length,
    histogram,
  };
}
