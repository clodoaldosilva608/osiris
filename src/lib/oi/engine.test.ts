import { describe, it, expect } from 'vitest';
import { DEPTHS, askRun, estimateCalls, mapLimit, panelFor, runEngine, type EngineDeps } from './engine';
import { createDemoChat } from './demo';
import { ProviderError, type ChatFn } from './providers';
import { applyEvent, initialState, type RunState } from './state';
import type { Agent, ContextItem, OiEvent, Post } from './types';

const CONTEXT: ContextItem[] = [
  { id: 'c1', kind: 'news', title: 'Envoys due in Geneva', source: 'Wire', published: '2026-10-02T09:00:00Z', place: 'Geneva', lat: 46.2, lng: 6.14 },
  { id: 'c2', kind: 'news', title: 'New export controls floated', source: 'Wire', published: '2026-10-02T08:00:00Z', place: 'Washington', lat: 38.9, lng: -77 },
];

function harness(chat: ChatFn, injects: string[][] = []) {
  const events: OiEvent[] = [];
  const prompts: string[] = [];
  const recording: ChatFn = req => { prompts.push(req.user); return chat(req); };
  const deps: EngineDeps = {
    chat: recording,
    concurrency: 3,
    emit: e => events.push(e),
    signal: new AbortController().signal,
    takeInjects: () => injects.shift() ?? [],
    gather: async () => CONTEXT,
    today: '2026-10-02',
  };
  return { events, prompts, deps };
}

const fold = (events: OiEvent[]): RunState =>
  events.reduce((s, e, seq) => applyEvent(s, { ...e, seq, at: seq } as never), initialState());

describe('runEngine', () => {
  it('runs every stage and draws the analysis as it goes', async () => {
    const h = harness(createDemoChat());
    await runEngine({ question: 'Will the envoys sign a framework deal by year end?', seed: '', depth: 'quick', useFeeds: true }, h.deps);

    const phases = h.events.filter(e => e.t === 'phase').map(e => (e as { phase: string }).phase);
    expect(phases).toEqual(['context', 'graph', 'agents', 'simulate', 'simulate', 'report']);

    const s = fold(h.events);
    const d = DEPTHS.quick;
    expect(s.context).toHaveLength(2);
    expect(s.frame?.proposition).toContain('envoys');
    expect(s.actors.length).toBeGreaterThan(5);
    expect(s.agents).toHaveLength(d.agents);
    expect(s.posts).toHaveLength(d.agents * d.rounds);
    expect(s.rounds.map(r => r.round)).toEqual([1, 2]);
    const kinds = new Set(s.links.map(l => l.kind));
    expect(kinds).toEqual(new Set(['relation', 'evidence', 'focus', 'reply']));
    expect(s.report?.probability).toBeCloseTo(s.rounds[1].consensus, 1);
    expect(s.usage.calls).toBe(estimateCalls('quick'));
    expect(h.prompts.length).toBe(estimateCalls('quick'));
  });

  it('forecasts a choice between outcomes as shares', async () => {
    const h = harness(createDemoChat());
    await runEngine({ question: 'Who will win the runoff in December?', seed: '', depth: 'quick', useFeeds: false }, h.deps);
    const s = fold(h.events);
    expect(s.frame?.kind).toBe('choice');
    expect(s.frame?.outcomes.length).toBeGreaterThanOrEqual(2);
    expect(s.posts.every(p => p.shares?.length === s.frame!.outcomes.length)).toBe(true);
    expect(s.rounds.every(r => r.shares && Math.abs(r.shares.reduce((t, v) => t + v, 0) - 1) < 0.01)).toBe(true);
    expect(s.report?.shares?.length).toBe(s.frame!.outcomes.length);
    expect(s.report?.answer).toMatch(/^Front-runner \(\d+%\)$/);
    expect(h.prompts.find(p => p.includes('This is round'))).toContain('OUTCOMES: 1. Front-runner');
  });

  it('forecasts a quantity as an estimate with a range', async () => {
    const h = harness(createDemoChat());
    await runEngine({ question: 'How much will Brent crude cost on 31 December?', seed: '', depth: 'quick', useFeeds: false }, h.deps);
    const s = fold(h.events);
    expect(s.frame).toMatchObject({ kind: 'number', unit: 'USD per barrel', anchor: 84.2 });
    expect(s.posts.every(p => p.estimate && p.estimate.low <= p.estimate.value && p.estimate.value <= p.estimate.high)).toBe(true);
    expect(s.rounds.every(r => r.value && Number.isFinite(r.value.median))).toBe(true);
    expect(s.report?.estimate?.value).toBeCloseTo(s.rounds[1].value!.median, 1);
    expect(s.report?.answer).toMatch(/USD per barrel \(/);
    expect(h.prompts.find(p => p.includes('This is round'))).toContain('"estimate": number');
  });

  it('feeds live context into the world model and the panel', async () => {
    const h = harness(createDemoChat());
    await runEngine({ question: 'Will the envoys sign a deal?', seed: 'Leaked draft text.', depth: 'quick', useFeeds: true }, h.deps);
    expect(h.prompts[0]).toContain('[c1]');
    expect(h.prompts[0]).toContain('Leaked draft text.');
    expect(h.prompts.find(p => p.includes('This is round'))).toContain('Envoys due in Geneva');
  });

  it('puts an injected event in front of the panel from the next round on, and in the report', async () => {
    const h = harness(createDemoChat(), [[], ['A ceasefire is announced in Geneva']]);
    await runEngine({ question: 'Will the envoys sign a deal?', seed: '', depth: 'quick', useFeeds: false }, h.deps);
    const round1 = h.prompts.filter(p => p.includes('This is round 1'));
    const round2 = h.prompts.filter(p => p.includes('This is round 2'));
    expect(round1.every(p => !p.includes('ceasefire'))).toBe(true);
    expect(round2.every(p => p.includes('A ceasefire is announced in Geneva'))).toBe(true);
    expect(h.prompts[h.prompts.length - 1]).toContain('A ceasefire is announced in Geneva');
    expect(fold(h.events).injects).toEqual([{ text: 'A ceasefire is announced in Geneva', round: 2 }]);
  });

  it('lets a panelist sit out a round when their call fails', async () => {
    const demo = createDemoChat();
    let failed = 0;
    const flaky: ChatFn = async req => {
      if (req.user.includes('This is round 1') && failed++ === 0) throw new ProviderError('upstream', 'boom');
      return demo(req);
    };
    const h = harness(flaky);
    await runEngine({ question: 'Will the envoys sign a deal?', seed: '', depth: 'quick', useFeeds: false }, h.deps);
    const s = fold(h.events);
    expect(s.warnings.join(' ')).toMatch(/sat out round 1/);
    expect(s.rounds[0].n).toBe(DEPTHS.quick.agents - 1);
    expect(s.report).not.toBeNull();
  });

  it('stops everything on a rejected key', async () => {
    let calls = 0;
    const h = harness(async () => { calls++; throw new ProviderError('auth', 'OpenAI rejected the key'); });
    await expect(runEngine({ question: 'Will the envoys sign a deal?', seed: '', depth: 'deep', useFeeds: false }, h.deps)).rejects.toThrow(/rejected the key/);
    expect(calls).toBe(1);
  });

  it('gives up when most of the panel cannot answer', async () => {
    const demo = createDemoChat();
    const h = harness(async req => {
      if (req.user.includes('This is round')) throw new ProviderError('upstream', 'overloaded');
      return demo(req);
    });
    await expect(runEngine({ question: 'Will the envoys sign a deal?', seed: '', depth: 'quick', useFeeds: false }, h.deps)).rejects.toThrow(/Most of the panel/);
  });

  it('retries a reply that does not parse, once', async () => {
    const demo = createDemoChat();
    let garbled = 0;
    const h = harness(async req => {
      if (req.user.includes('Build the world model') && garbled++ === 0) return { text: 'I think the answer is complicated.', input: 1, output: 1 };
      return demo(req);
    });
    await runEngine({ question: 'Will the envoys sign a deal?', seed: '', depth: 'quick', useFeeds: false }, h.deps);
    expect(h.prompts[1]).toContain('could not be parsed');
  });

  it('stops when cancelled', async () => {
    const ac = new AbortController();
    const demo = createDemoChat();
    const h = harness(async req => {
      if (req.user.includes('This is round')) ac.abort(new Error('cancelled'));
      return demo(req);
    });
    h.deps.signal = ac.signal;
    await expect(runEngine({ question: 'Will the envoys sign a deal?', seed: '', depth: 'quick', useFeeds: false }, h.deps)).rejects.toThrow('cancelled');
    expect(fold(h.events).report).toBeNull();
  });
});

describe('panelFor', () => {
  const agent = (id: string): Agent => ({ id, name: id, role: '', lens: '', bias: '', prior: 0.5, watches: [], place: '', lat: null, lng: null });
  const post = (a: string, p: number, c: number, to: string[] = []): Post => ({
    id: a, agent: a, round: 1, probability: p, confidence: c, text: '', reasoning: '', changed: '', focus: [],
    replies: to.map(t => ({ to: t, stance: 'disagree' as const, point: '' })),
  });

  it('shows replies first, then both ends of the range, then confidence', () => {
    const agents = new Map(['me', 'a', 'b', 'c', 'd'].map(id => [id, agent(id)]));
    const prev = [post('me', 0.5, 1), post('a', 0.5, 0.9), post('b', 0.1, 0.1), post('c', 0.9, 0.2), post('d', 0.5, 0.3, ['me'])];
    expect(panelFor(agents.get('me')!, prev, agents, 4).map(x => x.agent.id)).toEqual(['d', 'b', 'c', 'a']);
  });
});

describe('askRun', () => {
  it('talks to the report agent and to a panelist, on the run they were in', async () => {
    const h = harness(createDemoChat());
    await runEngine({ question: 'Will the envoys sign a deal?', seed: '', depth: 'quick', useFeeds: false }, h.deps);
    const s = fold(h.events);
    const seen: string[] = [];
    const chat: ChatFn = async req => { seen.push(req.user); return { text: 'Because.', input: 1, output: 1 }; };
    expect((await askRun(s, 'report', 'Why so low?', chat)).reply).toBe('Because.');
    expect(seen[0]).toContain(s.report!.headline);
    await askRun(s, s.agents[0].id, 'What would change your mind?', chat);
    expect(seen[1]).toContain(`You are ${s.agents[0].name}`);
    await expect(askRun(s, 'nobody', 'hi', chat)).rejects.toThrow(/No panelist/);
  });
});

describe('mapLimit', () => {
  it('never runs more than the limit at once', async () => {
    let live = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async n => {
      peak = Math.max(peak, ++live);
      await new Promise(r => setTimeout(r, 5));
      live--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });
});
