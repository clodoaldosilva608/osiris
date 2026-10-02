import { describe, it, expect } from 'vitest';
import { applyEvent, currentProbability, initialState } from './state';
import type { Link, OiEvent, Stamped } from './types';

const stamp = (e: OiEvent, seq: number): Stamped => ({ ...e, seq, at: 1000 + seq } as Stamped);

const link = (id: string, tone: Link['tone']): Link => ({ id, from: 'g:a', to: 'g:b', kind: 'reply', tone, strength: 0.5, label: '', round: 1 });

describe('applyEvent', () => {
  it('ignores an event it has already seen', () => {
    const s1 = applyEvent(initialState(), stamp({ t: 'warn', message: 'once' }, 0));
    expect(applyEvent(s1, stamp({ t: 'warn', message: 'once' }, 0))).toBe(s1);
  });

  it('redraws a link that comes again, as the newest', () => {
    let s = initialState();
    s = applyEvent(s, stamp({ t: 'link', link: link('rp:a:b', 'support') }, 0));
    s = applyEvent(s, stamp({ t: 'link', link: link('x', 'neutral') }, 1));
    s = applyEvent(s, stamp({ t: 'link', link: link('rp:a:b', 'oppose') }, 2));
    expect(s.links.map(l => [l.id, l.tone])).toEqual([['x', 'neutral'], ['rp:a:b', 'oppose']]);
  });

  it('tracks who is thinking until they post or the round closes', () => {
    let s = initialState();
    s = applyEvent(s, stamp({ t: 'thinking', agent: 'a', round: 1 }, 0));
    s = applyEvent(s, stamp({ t: 'thinking', agent: 'b', round: 1 }, 1));
    s = applyEvent(s, stamp({ t: 'post', post: { id: 'a:1', agent: 'a', round: 1, probability: 0.4, confidence: 0.5, text: '', reasoning: '', changed: '', replies: [], focus: [] } }, 2));
    expect(Object.keys(s.thinking)).toEqual(['b']);
    s = applyEvent(s, stamp({ t: 'round', stat: { round: 1, consensus: 0.4, median: 0.4, mean: 0.4, p25: 0.4, p75: 0.4, min: 0.4, max: 0.4, spread: 0, n: 1, histogram: [] } }, 3));
    expect(s.thinking).toEqual({});
    expect(currentProbability(s)).toBe(0.4);
  });

  it('ends', () => {
    const s = applyEvent(initialState(), stamp({ t: 'end', status: 'failed', message: 'nope' }, 0));
    expect(s).toMatchObject({ status: 'failed', message: 'nope' });
  });
});
