/** How big a run is. Kept apart from the engine so the browser can read it without the server code. */
import type { Depth } from './types';

export const DEPTHS: Record<Depth, { label: string; agents: number; rounds: number; feed: number }> = {
  quick: { label: 'Quick', agents: 6, rounds: 2, feed: 14 },
  standard: { label: 'Standard', agents: 10, rounds: 3, feed: 20 },
  deep: { label: 'Deep', agents: 16, rounds: 4, feed: 28 },
};

/** Model calls a run makes, before any retries: world, panel, every turn, report. */
export function estimateCalls(depth: Depth): number {
  const d = DEPTHS[depth];
  return 3 + d.agents * d.rounds;
}

/** The most of the caller's own data a run reads: about 25,000 tokens, read once by the world model. */
export const SEED_MAX = 100_000;
/** How much of it every forecaster and the report agent also read when the whole panel reads it. */
export const PANEL_SEED_MAX = 8_000;

/** Where the caller's data goes: the world model's brief only, or every forecaster and the report too. */
export type SeedScope = 'brief' | 'panel';

/** Rough tokens in a text: about four characters each, for English prose and tables alike. */
export const tokensIn = (chars: number) => Math.ceil(chars / 4);

/**
 * The input tokens the caller's data adds to a run, before retries: the
 * world model reads all of it once; with the whole panel reading it, every
 * turn and the report read the first PANEL_SEED_MAX characters too.
 */
export function seedCost(chars: number, depth: Depth, scope: SeedScope): { tokens: number; calls: number } {
  const n = Math.min(Math.max(0, chars), SEED_MAX);
  if (!n) return { tokens: 0, calls: 0 };
  const once = tokensIn(n);
  if (scope === 'brief') return { tokens: once, calls: 1 };
  const d = DEPTHS[depth];
  const reads = d.agents * d.rounds + 1;
  return { tokens: once + tokensIn(Math.min(n, PANEL_SEED_MAX)) * reads, calls: 1 + reads };
}
