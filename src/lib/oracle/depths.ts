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
