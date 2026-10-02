import { describe, it, expect } from 'vitest';
import { brief, nodeName, postFor, relatedLinks, resolve } from './research';
import { initialState, type RunState } from './state';
import type { Link, Post } from './types';

const link = (over: Partial<Link>): Link => ({ id: 'l', from: 'a:usa', to: 'a:cn', kind: 'relation', tone: 'oppose', strength: 0.8, label: 'trade war', round: 0, ...over });
const post = (over: Partial<Post>): Post => ({
  id: 'p', agent: 'mara', round: 1, probability: 0.4, confidence: 0.6, text: 'I doubt it.', reasoning: '', changed: '', replies: [], focus: [], ...over,
});

const s: RunState = {
  ...initialState(),
  frame: { question: 'q', kind: 'binary', proposition: 'p', resolution: '', horizon: '', outcomes: [], unit: '', baseRate: 0.3, prior: [], anchor: null, baseRateReason: '', focus: null },
  actors: [
    { id: 'usa', name: 'United States', kind: 'state', role: 'Sets tariffs', lean: 0.2, place: '', lat: 38, lng: -77 },
    { id: 'cn', name: 'China', kind: 'state', role: 'Responds', lean: -0.3, place: '', lat: 39, lng: 116 },
  ],
  agents: [
    { id: 'mara', name: 'Mara Ellison', role: 'Analyst', lens: '', bias: '', prior: 0.4, watches: [], place: 'New York', lat: 40, lng: -74 },
    { id: 'ken', name: 'Kenji Arakawa', role: 'Trader', lens: '', bias: '', prior: 0.5, watches: [], place: 'Tokyo', lat: 35, lng: 139 },
  ],
  context: [{ id: 'c1', kind: 'news', title: 'Tariff talks stall', source: 'Wire', published: '', place: 'Geneva', lat: 46, lng: 6 }],
  links: [
    link({ id: 'rel:cn|usa' }),
    link({ id: 'ev:c1:cn:0', from: 'c:c1', to: 'a:cn', kind: 'evidence', tone: 'oppose', label: 'talks stalled' }),
    link({ id: 'rp:mara:ken', from: 'g:mara', to: 'g:ken', kind: 'reply', tone: 'oppose', round: 2, label: 'too early' }),
    link({ id: 'fc:ken:usa', from: 'g:ken', to: 'a:usa', kind: 'focus', tone: 'neutral', round: 2 }),
  ],
  posts: [post({ id: 'mara:1' }), post({ id: 'mara:2', round: 2, probability: 0.35 }), post({ id: 'ken:2', agent: 'ken', round: 2, probability: 0.5 })],
};

describe('resolving a click', () => {
  it('finds arcs and points by key, and nothing for a stale key', () => {
    expect(resolve(s, 'link:rel:cn|usa')?.type).toBe('link');
    expect(resolve(s, 'a:usa')?.type).toBe('actor');
    expect(resolve(s, 'g:ken')?.type).toBe('agent');
    expect(resolve(s, 'c:c1')?.type).toBe('context');
    expect(resolve(s, 'a:mars')).toBeNull();
    expect(resolve(s, 's:0')).toBeNull();
    expect(resolve(s, null)).toBeNull();
  });

  it('lights the arc itself, or every arc touching a point', () => {
    expect([...relatedLinks(s, 'link:rel:cn|usa')]).toEqual(['rel:cn|usa']);
    expect(relatedLinks(s, 'a:cn')).toEqual(new Set(['rel:cn|usa', 'ev:c1:cn:0']));
    expect(relatedLinks(s, 'g:ken')).toEqual(new Set(['rp:mara:ken', 'fc:ken:usa']));
  });

  it('finds the turn an arc was drawn from', () => {
    expect(postFor(s, s.links[2])?.id).toBe('mara:2');
    expect(postFor(s, s.links[0])).toBeUndefined();
    expect(nodeName(s, 'c:c1')).toBe('Tariff talks stall');
  });

  it('says in two lines what an arc or point is', () => {
    expect(brief(s, 'link:rel:cn|usa')).toEqual({ title: 'United States ⇄ China', detail: 'opposed · trade war' });
    expect(brief(s, 'link:ev:c1:cn:0')).toEqual({ title: 'Tariff talks stall', detail: 'points toward NO: China' });
    expect(brief(s, 'link:rp:mara:ken')?.title).toBe('Mara Ellison disputes Kenji Arakawa');
    expect(brief(s, 'link:fc:ken:usa')).toEqual({ title: 'Kenji Arakawa weighing United States', detail: 'Round 2 · 50%' });
    expect(brief(s, 'g:mara')?.detail).toBe('Analyst · 35%');
  });
});
