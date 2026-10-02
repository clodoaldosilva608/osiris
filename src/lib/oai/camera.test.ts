import { describe, it, expect } from 'vitest';
import { activityCentre, beatOf, centreOf, frame, frameRun, shotFor, zoomForSpread } from './camera';
import { initialState, type RunState } from './state';
import type { Actor, Agent, Link } from './types';

const actor = (id: string, lng: number, lat: number): Actor => ({ id, name: id, kind: 'state', role: '', lean: 0, place: '', lat, lng });
const agent = (id: string, lng: number, lat: number): Agent => ({ id, name: id, role: '', lens: '', bias: '', prior: 0.5, watches: [], place: '', lat, lng });

function run(over: Partial<RunState>): RunState {
  return { ...initialState(), roundsPlanned: 3, ...over };
}

describe('framing', () => {
  it('centres between points either side of the date line', () => {
    const [lng, lat] = centreOf([[179, 0], [-179, 0]])!;
    expect(Math.abs(Math.abs(lng) - 180)).toBeLessThan(0.01);
    expect(lat).toBeCloseTo(0, 5);
  });

  it('steps back for a wide spread and for a narrow view', () => {
    expect(zoomForSpread(9000)).toBeLessThan(zoomForSpread(500));
    const wide = frame([[0, 0], [10, 0]], 1280)!;
    const narrow = frame([[0, 0], [10, 0]], 400)!;
    expect(narrow.zoom).toBeLessThan(wide.zoom);
  });

  it('frames a run by its actors, else its focus, else nothing', () => {
    expect(frameRun(run({ actors: [actor('a', 0, 50), actor('b', 20, 50)] }))?.lng).toBeCloseTo(10, 0);
    expect(frameRun(run({ frame: { focus: { place: 'Geneva', lat: 46.2, lng: 6.1 } } as RunState['frame'] }))).toMatchObject({ lat: 46.2, lng: 6.1 });
    expect(frameRun(run({}))).toBeNull();
  });
});

describe('the beats of a run', () => {
  const actors = [actor('a', 0, 50), actor('b', 30, 40)];
  const agents = [agent('x', -70, 40), agent('y', 100, 30)];

  it('moves from world to panel to rounds to report', () => {
    expect(beatOf(run({}))).toBeNull();
    expect(beatOf(run({ actors }))).toBe('world');
    expect(beatOf(run({ actors, agents }))).toBe('panel');
    expect(beatOf(run({ actors, agents, phase: 'simulate' }))).toBe('round:1');
    expect(beatOf(run({ actors, agents, phase: 'simulate', rounds: [{ round: 1 } as RunState['rounds'][number]] }))).toBe('round:2');
    expect(beatOf(run({ actors, agents, report: {} as RunState['report'] }))).toBe('report');
  });

  it('tilts further and swings the bearing as the run goes on', () => {
    const s = run({ actors, agents });
    const world = shotFor(s, 'world', 0)!;
    const panel = shotFor(s, 'panel', world.bearing)!;
    const r1 = shotFor(s, 'round:1', panel.bearing)!;
    const r2 = shotFor(s, 'round:2', r1.bearing)!;
    expect(world.pitch).toBeLessThan(panel.pitch);
    expect(panel.pitch).toBeLessThan(r1.pitch);
    expect(r1.bearing).not.toBe(panel.bearing);
    expect(Math.sign(r2.bearing - r1.bearing)).not.toBe(Math.sign(r1.bearing - panel.bearing));
    // The panel shot takes in the panelists too, so it is wider than the world shot.
    expect(panel.zoom).toBeLessThan(world.zoom);
  });

  it('closes in on where the forecast plays out', () => {
    const s = run({
      actors, agents,
      frame: { focus: { place: 'Geneva', lat: 46.2, lng: 6.1 } } as RunState['frame'],
      report: { scenarios: [] } as unknown as RunState['report'],
    });
    const shot = shotFor(s, 'report', 0)!;
    expect(shot.lat).toBeCloseTo(46.2, 0);
    expect(shot.pitch).toBeGreaterThanOrEqual(45);
  });
});

describe('where the exchange is', () => {
  it('needs enough of a round to say', () => {
    const link = (id: string, from: string, to: string): Link => ({ id, from, to, kind: 'reply', tone: 'support', strength: 0.5, label: '', round: 2 });
    const s = run({
      agents: [agent('x', 10, 10), agent('y', 12, 12), agent('z', 14, 14)],
      links: [link('1', 'g:x', 'g:y'), link('2', 'g:y', 'g:z')],
    });
    expect(activityCentre(s, 2)).toBeNull();
    const busier = { ...s, links: [...s.links, link('3', 'g:z', 'g:x')] };
    const c = activityCentre(busier, 2)!;
    expect(c[0]).toBeGreaterThan(10);
    expect(c[0]).toBeLessThan(14);
    expect(activityCentre(busier, 1)).toBeNull();
  });
});
