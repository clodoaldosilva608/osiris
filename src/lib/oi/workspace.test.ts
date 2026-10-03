import { describe, it, expect } from 'vitest';
import { applyEvent, initialState, type RunState } from './state';
import { formatDuration, progressOf, traceOf } from './trace';
import { mentions, objectsOf, searchObjects } from './objects';
import { rangeOf, timelineOf } from './timeline';
import type { Frame, OiEvent, Post, RoundStat } from './types';

/** Folds events into a state the way the panel does, one second apart. */
function run(events: OiEvent[], t0 = 1_000_000): RunState {
  return events.reduce((s, e, i) => applyEvent(s, { ...e, seq: i, at: t0 + i * 1000 } as never), initialState());
}

const binary: Frame = { question: 'q', kind: 'binary', proposition: 'p', resolution: '', horizon: '', outcomes: [], unit: '', baseRate: 0.3, prior: [], anchor: null, baseRateReason: '', focus: null };
const post = (agent: string, round: number, probability: number, over: Partial<Post> = {}): Post => ({
  id: `${agent}:${round}`, agent, round, probability, confidence: 0.6, text: '', reasoning: '', changed: '', replies: [], focus: [], ...over,
});

const stat = (round: number, consensus: number, p25: number, p75: number, n: number): RoundStat => ({
  round, consensus, median: consensus, mean: consensus, p25, p75, min: p25, max: p75, spread: p75 - p25, n, histogram: Array(10).fill(0),
});

const start: OiEvent = { t: 'start', question: 'Will it?', depth: 'quick', provider: 'demo', model: 'scripted', agents: 2, rounds: 2 };
const base: OiEvent[] = [
  start,
  { t: 'phase', phase: 'context', label: 'Reading the live OSIRIS feeds' },
  { t: 'context', items: [{ id: 'c1', kind: 'news', title: 'Talks stall in Geneva', source: 'Wire', published: '', place: 'Geneva', lat: 46, lng: 6 }, { id: 'c2', kind: 'quake', title: 'M5 quake', source: 'USGS', published: '', place: '', lat: null, lng: null }] },
  { t: 'phase', phase: 'graph', label: 'Mapping actors and relations' },
  { t: 'frame', frame: binary },
  { t: 'actor', actor: { id: 'cn', name: 'China', kind: 'state', role: 'Responds', lean: -0.3, place: '', lat: 39, lng: 116 } },
  { t: 'actor', actor: { id: 'eu', name: 'European Union', kind: 'organisation', role: 'Mediates', lean: 0, place: '', lat: 50, lng: 4 } },
  { t: 'phase', phase: 'agents', label: 'Assembling a panel of 2' },
  { t: 'agent', agent: { id: 'mara', name: 'Mara Ellison', role: 'Analyst', lens: '', bias: '', prior: 0.4, watches: [], place: 'New York', lat: 40, lng: -74 } },
  { t: 'agent', agent: { id: 'lucia', name: 'Lucía Ferreyra', role: 'Economist', lens: '', bias: '', prior: 0.5, watches: [], place: 'Buenos Aires', lat: -34, lng: -58 } },
  { t: 'phase', phase: 'simulate', label: 'Round 1 of 2: the panel is debating' },
  { t: 'post', post: post('mara', 1, 0.4) },
  { t: 'post', post: post('lucia', 1, 0.6, { replies: [{ to: 'mara', stance: 'disagree', point: 'too slow' }] }) },
  { t: 'round', stat: stat(1, 0.5, 0.4, 0.6, 2) },
];

describe('the execution trace', () => {
  it('lists the whole plan, with what has run timed and what has not pending', () => {
    const steps = traceOf(run(base));
    expect(steps.map(st => st.id)).toEqual(['context', 'graph', 'agents', 'round:1', 'round:2', 'report']);
    expect(steps.map(st => st.status)).toEqual(['done', 'done', 'done', 'active', 'pending', 'pending']);
    expect(steps[0].end! - steps[0].start!).toBe(2000);
    expect(steps[3].end).toBeNull();
    expect(steps[0].metrics).toEqual([{ label: 'Sources', value: '2' }, { label: 'News', value: '1' }, { label: 'Quakes', value: '1' }]);
    expect(steps[1].metrics).toContainEqual({ label: 'Base rate', value: '30%' });
    expect(steps[3].metrics).toEqual([
      { label: 'Turns', value: '2 / 2' }, { label: 'Replies', value: '1' },
      { label: 'Consensus', value: '50%' }, { label: 'Spread', value: '40%–60%' },
    ]);
    expect(progressOf(steps)).toBeCloseTo(3.5 / 6);
  });

  it('closes the last step when the run ends, and marks what it never reached', () => {
    const steps = traceOf(run([...base, { t: 'end', status: 'cancelled', message: 'Stopped' }]));
    expect(steps.find(st => st.id === 'round:1')).toMatchObject({ status: 'failed', end: 1_000_000 + 14_000 });
    expect(steps.filter(st => st.status === 'skipped').map(st => st.id)).toEqual(['round:2', 'report']);
  });

  it('says how long, in tenths of a second, then minutes', () => {
    expect(formatDuration(430)).toBe('0.4s');
    expect(formatDuration(12_340)).toBe('12.3s');
    expect(formatDuration(65_000)).toBe('1m 05s');
    expect(formatDuration(-1)).toBe('—');
  });
});

describe('the run as objects', () => {
  const s = run(base);

  it('lists every object under its research key', () => {
    expect(objectsOf(s).map(o => `${o.type}:${o.key}`)).toEqual([
      'actor:a:cn', 'actor:a:eu', 'panelist:g:mara', 'panelist:g:lucia', 'source:c:c1', 'source:c:c2',
    ]);
  });

  it('finds objects by name, best match first, ignoring case and accents', () => {
    expect(searchObjects(s, 'eu').map(o => o.key)).toEqual(['a:eu']);
    expect(searchObjects(s, 'union')[0].key).toBe('a:eu');
    expect(searchObjects(s, 'LUCIA')[0].key).toBe('g:lucia');
    expect(searchObjects(s, 'geneva').map(o => o.key)).toEqual(['c:c1']);
    expect(searchObjects(s, '   ')).toEqual([]);
  });

  it('finds actors and panelists named in text, whole words only', () => {
    expect(mentions('mara ellison says China will wait; the European Union agrees. Chinatown is not China.', s)).toEqual([
      { key: 'g:mara', text: 'mara ellison' }, ' says ', { key: 'a:cn', text: 'China' }, ' will wait; the ',
      { key: 'a:eu', text: 'European Union' }, ' agrees. Chinatown is not ', { key: 'a:cn', text: 'China' }, '.',
    ]);
    expect(mentions('Lucía Ferreyra disagrees.', s)[0]).toEqual({ key: 'g:lucia', text: 'Lucía Ferreyra' });
    expect(mentions('nothing here', s)).toEqual(['nothing here']);
    expect(mentions('', s)).toEqual([]);
  });
});

describe('the debate over time', () => {
  it('gives each panelist a lane with their view per round and how far it moved', () => {
    const s = run([...base,
      { t: 'phase', phase: 'simulate', label: 'Round 2 of 2: the panel is debating' },
      { t: 'post', post: post('mara', 2, 0.55) },
      { t: 'round', stat: stat(2, 0.55, 0.55, 0.55, 1) },
    ]);
    const tl = timelineOf(s);
    expect(tl.rounds).toEqual([1, 2]);
    const mara = tl.lanes.find(l => l.key === 'g:mara')!;
    expect(mara.cells.map(c => c?.value)).toEqual([0.4, 0.55]);
    expect(mara.cells[1]!.delta).toBeCloseTo(0.15);
    expect(mara.drift).toBeCloseTo(0.15);
    const lucia = tl.lanes.find(l => l.key === 'g:lucia')!;
    expect(lucia.cells[1]).toBeNull();
    expect(lucia.drift).toBeNull();
    expect(tl.pooled.map(p => p?.label)).toEqual(['50%', '55%']);
    expect(tl.reference).toEqual({ value: 0.3, label: 'Base rate 30%' });
    expect(tl.ends).toEqual(['NO', 'YES']);
  });

  it('puts a number question on one scale across every round, the report and today', () => {
    const number: Frame = { ...binary, kind: 'number', unit: 'USD', anchor: 80 };
    const s = run([start, { t: 'frame', frame: number },
      { t: 'agent', agent: { id: 'mara', name: 'Mara', role: '', lens: '', bias: '', prior: 0.5, watches: [], place: '', lat: null, lng: null } },
      { t: 'post', post: post('mara', 1, 0.5, { estimate: { value: 70, low: 60, high: 75 } }) },
      { t: 'post', post: post('mara', 2, 0.5, { estimate: { value: 90, low: 85, high: 95 } }) },
    ]);
    expect(rangeOf(s)).toEqual([70, 90]);
    const tl = timelineOf(s);
    expect(tl.lanes[0].cells.map(c => c?.value)).toEqual([0, 1]);
    expect(tl.reference?.value).toBeCloseTo(0.5);
    expect(rangeOf(initialState())).toEqual([0, 1]);
  });
});

describe('the workspace geometry', () => {
  it('grows its columns with the screen, within limits, and centres the globe between them', async () => {
    const { workspaceLayout, workspaceInsets } = await import('./layout');
    expect(workspaceLayout(1280)).toMatchObject({ left: 320, right: 360 });
    expect(workspaceLayout(1440)).toMatchObject({ left: 346, right: 389 });
    expect(workspaceLayout(2560)).toMatchObject({ left: 392, right: 440 });
    expect(workspaceLayout(NaN).left).toBe(346);
    expect(workspaceInsets(1440)).toEqual({ top: 76, bottom: 24, left: 378, right: 421 });
    expect(workspaceInsets(1440, false)).toEqual({ top: 76, bottom: 24, left: 378, right: 16 });
  });
});
