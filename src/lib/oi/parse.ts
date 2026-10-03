/**
 * Reading model output. Models are asked for JSON and mostly comply, but they
 * wrap it in prose, fence it in markdown, think out loud before it, leave
 * trailing commas and write "45%" for 0.45. Everything here is defensive: a
 * value that is missing or out of range becomes a safe default, never a crash,
 * and nothing the model writes reaches the page as markup (it is rendered as
 * text) or grows beyond a fixed length.
 */
import { centroidFor } from '@/lib/countryCentroids';
import { amount, answerText, normalizeShares, orderEstimate, uniform } from './forecast';
import { parseCites, sourceIds } from './sources';
import type {
  Actor, ActorKind, Agent, ContextItem, Driver, Estimate, Frame, Link, Located, Post, Reply, Report, Scenario, Signpost, Tone,
} from './types';

/* ───────────────────────────── JSON ───────────────────────────── */

/** The first JSON object in a model's reply. Throws when there is none. */
export function extractJson(text: string): Record<string, unknown> {
  let s = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = s.indexOf('{');
  if (start < 0) throw new Error('no JSON object in the reply');
  s = s.slice(start);

  // Walk to the brace that closes the first one, minding strings.
  let depth = 0;
  let inString = false;
  let end = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = i; break; }
  }
  const body = end >= 0 ? s.slice(0, end + 1) : s;

  for (const candidate of [body, body.replace(/,\s*([}\]])/g, '$1')]) {
    try {
      const v = JSON.parse(candidate);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch { /* try the next repair */ }
  }
  throw new Error('the reply was not valid JSON');
}

/* ───────────────────────────── Values ───────────────────────────── */

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A number in range, from a number or a numeric string. */
export function num(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
}

/**
 * A probability in [0.01, 0.99]. Reads 0.45, "0.45", 45 and "45%" alike.
 * Never 0 or 1: nothing in the world is certain, and the pooled log-odds need finite values.
 */
export function prob(v: unknown, fallback: number): number {
  let n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  if (n > 1 && n <= 100) n /= 100;
  return clamp(n, 0.01, 0.99);
}

/** Plain text: control characters out, whitespace collapsed, cut to `max`. */
export function text(v: unknown, max: number, fallback = ''): string {
  if (typeof v !== 'string' && typeof v !== 'number') return fallback;
  const s = String(v).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return fallback;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** A short id: lowercase letters, digits, underscore. */
export function slug(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) : '';
  return s || fallback;
}

export function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  const s = typeof v === 'string' ? v.toLowerCase().trim() : '';
  return (options as readonly string[]).includes(s) ? (s as T) : fallback;
}

export function list(v: unknown, max: number): unknown[] {
  return Array.isArray(v) ? v.slice(0, max) : [];
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

/** A model-given place. Falls back to the country's centroid, then to nowhere. (0, 0) is a missing value, not the Gulf of Guinea. */
export function locate(v: Record<string, unknown>, fallbackPlace = ''): Located {
  const place = text(v.place ?? v.location ?? v.city, 80, fallbackPlace);
  const lat = num(v.lat ?? v.latitude, -90, 90, NaN);
  const lng = num(v.lng ?? v.lon ?? v.longitude, -180, 180, NaN);
  const valid = Number.isFinite(lat) && Number.isFinite(lng) && !(Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01)
    && Math.abs(lat) <= 85;
  if (valid) return { place, lat: round4(lat), lng: round4(lng) };
  const c = centroidFor(typeof v.country === 'string' ? v.country.toUpperCase().slice(0, 2) : null);
  if (c) return { place, lat: c[1], lng: c[0] };
  return { place, lat: null, lng: null };
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * Nodes that share a spot (three actors "in Washington") are fanned out on a
 * small ring, so arcs between them have length and their markers do not stack.
 */
export function spreadDuplicates<T extends Located>(nodes: T[], radiusDeg = 0.9): T[] {
  const groups = new Map<string, number[]>();
  nodes.forEach((n, i) => {
    if (n.lat === null || n.lng === null) return;
    const k = `${n.lat.toFixed(1)},${n.lng.toFixed(1)}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  const out = nodes.slice();
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    idx.forEach((i, j) => {
      const n = out[i];
      const a = (2 * Math.PI * j) / idx.length;
      const lat = clamp(n.lat! + radiusDeg * Math.sin(a), -85, 85);
      const lng = n.lng! + (radiusDeg * Math.cos(a)) / Math.max(0.2, Math.cos((n.lat! * Math.PI) / 180));
      out[i] = { ...n, lat: round4(lat), lng: round4(((lng + 540) % 360) - 180) };
    });
  }
  return out;
}

/* ───────────────────────────── The world model ───────────────────────────── */

const ACTOR_KINDS: readonly ActorKind[] = ['state', 'leader', 'organisation', 'company', 'market', 'group', 'place'];

const SUPPORT_RELATIONS = new Set(['alliance', 'ally', 'trade', 'supply', 'negotiation', 'cooperation', 'support', 'partnership']);
const OPPOSE_RELATIONS = new Set(['rivalry', 'rival', 'conflict', 'war', 'sanction', 'sanctions', 'hostility', 'competition', 'opposition']);

export function relationTone(kind: string): Tone {
  if (SUPPORT_RELATIONS.has(kind)) return 'support';
  if (OPPOSE_RELATIONS.has(kind)) return 'oppose';
  return 'neutral';
}

export interface WorldModel {
  frame: Frame;
  actors: Actor[];
  links: Link[];
}

/** The question's kind and its outcomes. A choice with fewer than two usable outcomes is asked as yes or no. */
export function parseKind(raw: Record<string, unknown>): Pick<Frame, 'kind' | 'outcomes' | 'unit' | 'prior' | 'anchor'> {
  let kind = oneOf(raw.kind, ['binary', 'choice', 'number'] as const, 'binary');
  const outcomes: string[] = [];
  for (const o of list(raw.outcomes, 6)) {
    const label = text(typeof o === 'object' && o ? (o as Record<string, unknown>).label ?? (o as Record<string, unknown>).name : o, 60);
    if (label && !outcomes.some(x => x.toLowerCase() === label.toLowerCase())) outcomes.push(label);
  }
  if (kind === 'choice' && outcomes.length < 2) kind = 'binary';
  const anchor = kind === 'number' ? amount(raw.anchor) : null;
  return {
    kind,
    outcomes: kind === 'choice' ? outcomes : [],
    unit: kind === 'number' ? text(raw.unit, 40) : '',
    prior: kind === 'choice' ? normalizeShares(raw.prior, outcomes, uniform(outcomes.length)) : [],
    anchor,
  };
}

export function parseWorld(raw: Record<string, unknown>, question: string, context: ContextItem[]): WorldModel {
  const focusRaw = obj(raw.focus);
  const focus = locate(focusRaw);
  const frame: Frame = {
    question,
    ...parseKind(raw),
    proposition: text(raw.proposition, 300, question),
    resolution: text(raw.resolution, 400),
    horizon: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.horizon ?? '')) ? String(raw.horizon) : '',
    baseRate: prob(raw.base_rate ?? raw.baseRate, 0.5),
    baseRateReason: text(raw.base_rate_reason ?? raw.baseRateReason, 400),
    focus: focus.lat === null && !focus.place ? null : focus,
  };

  const actors: Actor[] = [];
  const ids = new Set<string>();
  for (const [i, a] of list(raw.actors, 16).entries()) {
    const o = obj(a);
    const name = text(o.name, 80);
    if (!name) continue;
    let id = slug(o.id ?? name, `actor_${i + 1}`);
    while (ids.has(id)) id = `${id}_${i}`;
    ids.add(id);
    actors.push({
      id,
      name,
      kind: oneOf(o.kind, ACTOR_KINDS, 'group'),
      role: text(o.role, 200),
      lean: num(o.lean, -1, 1, 0),
      ...locate(o),
    });
  }
  const placed = spreadDuplicates(actors);

  const links: Link[] = [];
  const pairs = new Set<string>();
  for (const r of list(raw.relations, 28)) {
    const o = obj(r);
    const from = slug(o.from, '');
    const to = slug(o.to, '');
    if (!ids.has(from) || !ids.has(to) || from === to) continue;
    const pair = [from, to].sort().join('|');
    if (pairs.has(pair)) continue;
    pairs.add(pair);
    const kind = text(o.kind, 24, 'influence').toLowerCase();
    links.push({
      id: `rel:${pair}`,
      from: `a:${from}`,
      to: `a:${to}`,
      kind: 'relation',
      tone: relationTone(kind),
      strength: num(o.strength, 0, 1, 0.5),
      label: text(o.note, 160, kind),
      round: 0,
    });
  }

  const ctxIds = new Set(context.map(c => c.id));
  for (const [i, e] of list(raw.evidence, 24).entries()) {
    const o = obj(e);
    const source = text(o.source, 12).toLowerCase();
    const actor = slug(o.actor, '');
    if (!ctxIds.has(source) || !ids.has(actor)) continue;
    const effect = oneOf(o.effect, ['yes', 'no', 'neutral'] as const, 'neutral');
    links.push({
      id: `ev:${source}:${actor}:${i}`,
      from: `c:${source}`,
      to: `a:${actor}`,
      kind: 'evidence',
      tone: effect === 'yes' ? 'support' : effect === 'no' ? 'oppose' : 'neutral',
      strength: 0.5,
      label: text(o.note, 160),
      round: 0,
    });
  }

  return { frame, actors: placed, links };
}

/* ───────────────────────────── The panel ───────────────────────────── */

/**
 * The panel. Panelists are anonymous: Agent 1, Agent 2… in the order given,
 * each known by their role, so no simulated view is ever put in a real or
 * realistic-sounding person's mouth. Whatever name a model adds is ignored.
 */
export function parseAgents(raw: Record<string, unknown>, count: number, actorIds: Set<string>): Agent[] {
  const agents: Agent[] = [];
  for (const a of list(raw.agents, count)) {
    const o = obj(a);
    const role = text(o.role ?? o.title ?? o.job, 120);
    if (!role) continue;
    const n = agents.length + 1;
    agents.push({
      id: `agent_${n}`,
      name: `Agent ${n}`,
      role,
      lens: text(o.lens, 200),
      bias: text(o.bias, 160),
      prior: prob(o.prior, 0.5),
      watches: list(o.watches, 3).map(w => slug(w, '')).filter(w => actorIds.has(w)),
      ...locate(o),
    });
  }
  return spreadDuplicates(agents, 0.6);
}

/** What a panelist said before, to fall back on when a reply leaves a figure out. */
export interface PostFallback {
  probability: number;
  shares?: number[];
  estimate?: Estimate;
}

/**
 * One panelist's turn. Throws when a number question's reply has no usable
 * estimate and there is nothing earlier to fall back on: that panelist sits
 * the round out rather than inventing a figure.
 */
export function parsePost(
  raw: Record<string, unknown>, agent: Agent, round: number, agentIds: Set<string>, actorIds: Set<string>,
  fallback: PostFallback, frame?: Pick<Frame, 'kind' | 'outcomes'>,
  /** What each citable source says, to check the post's quotes against. */
  sources?: Map<string, string>,
): Post {
  const replies: Reply[] = [];
  for (const r of list(raw.replies, 3)) {
    const o = obj(r);
    const to = slug(o.to, '');
    if (!agentIds.has(to) || to === agent.id || replies.some(x => x.to === to)) continue;
    replies.push({ to, stance: oneOf(o.stance, ['agree', 'disagree', 'question'] as const, 'question'), point: text(o.point, 160) });
  }
  let probability = prob(raw.probability, fallback.probability);
  let shares: number[] | undefined;
  let estimate: Estimate | undefined;
  if (frame?.kind === 'choice') {
    shares = normalizeShares(raw.shares ?? raw.distribution, frame.outcomes, fallback.shares ?? uniform(frame.outcomes.length));
    probability = Math.max(...shares);
  } else if (frame?.kind === 'number') {
    const e = obj(raw.estimate);
    const value = amount(raw.estimate !== null && typeof raw.estimate === 'object' ? e.value : raw.estimate) ?? fallback.estimate?.value ?? null;
    if (value === null) throw new Error('no estimate in the reply');
    estimate = orderEstimate(value, amount(raw.low ?? e.low), amount(raw.high ?? e.high));
    probability = 0.5;
  }
  return {
    id: `${agent.id}:${round}`,
    agent: agent.id,
    round,
    probability,
    ...(shares ? { shares } : {}),
    ...(estimate ? { estimate } : {}),
    confidence: num(raw.confidence, 0, 1, 0.5),
    text: text(raw.post, 320, '…'),
    reasoning: text(raw.reasoning, 320),
    changed: text(raw.changed, 200),
    replies,
    focus: list(raw.focus, 3).map(f => slug(f, '')).filter(f => actorIds.has(f)),
    cites: sources ? parseCites(raw.cites ?? raw.citations ?? raw.quotes, sources, 3, frame?.kind === 'choice' ? frame.outcomes : []) : [],
  };
}

/* ───────────────────────────── The report ───────────────────────────── */

/** A direction as a model writes it: yes/no, up/down, higher/lower, for/against. */
function direction(v: unknown): 'yes' | 'no' {
  const s = typeof v === 'string' ? v.toLowerCase().trim() : '';
  return /^(no|down|lower|against|decrease|less)/.test(s) ? 'no' : 'yes';
}

/** The outcome a driver or signpost helps, matched to the frame's labels. */
function favored(v: unknown, outcomes: string[]): string {
  const s = text(v, 60).toLowerCase();
  if (!s) return '';
  return outcomes.find(o => o.toLowerCase() === s) ?? outcomes.find(o => s.includes(o.toLowerCase()) || o.toLowerCase().includes(s)) ?? '';
}

/**
 * The report. `swarm` is where the panel ended: a binary question's pooled
 * P(YES), a choice question's pooled shares, a number question's pooled
 * estimate. The report agent's figures override it only where they parse.
 */
export function parseReport(
  raw: Record<string, unknown>,
  swarm: { probability: number; shares?: number[]; estimate?: Estimate },
  actorIds: Set<string>,
  frame?: Pick<Frame, 'kind' | 'outcomes' | 'unit'>,
  /** The ids a driver may cite. */
  sources?: Set<string>,
): Report {
  const outcomes = frame?.kind === 'choice' ? frame.outcomes : [];
  const drivers: Driver[] = list(raw.drivers, 6).map(d => {
    const o = obj(d);
    const actor = slug(o.actor, '');
    return {
      text: text(o.text, 220),
      push: direction(o.push),
      favors: favored(o.favors ?? o.push, outcomes),
      weight: num(o.weight, 0, 1, 0.5),
      actor: actorIds.has(actor) ? actor : null,
      ...(sources ? { sources: sourceIds(o.sources ?? o.source, sources) } : {}),
    };
  }).filter(d => d.text);

  const scenarios: Scenario[] = list(raw.scenarios, 4).map(s => {
    const o = obj(s);
    return { name: text(o.name, 80), probability: num(o.probability, 0, 1, 0), description: text(o.description, 360), ...locate(o) };
  }).filter(s => s.name);
  // Scenarios are alternatives: make them add up, whatever the model wrote.
  const total = scenarios.reduce((t, s) => t + s.probability, 0);
  if (total > 0) for (const s of scenarios) s.probability = Math.round((s.probability / total) * 100) / 100;

  const signposts: Signpost[] = list(raw.signposts, 6).map(s => {
    const o = obj(s);
    return { text: text(o.text, 220), means: direction(o.means), favors: favored(o.favors ?? o.means, outcomes), ...locate(o) };
  }).filter(s => s.text);

  let probability = prob(raw.probability, swarm.probability);
  let shares: number[] | undefined;
  let estimate: Estimate | undefined;
  if (frame?.kind === 'choice') {
    shares = normalizeShares(raw.shares ?? raw.distribution, outcomes, swarm.shares ?? uniform(outcomes.length));
    probability = Math.max(...shares);
  } else if (frame?.kind === 'number') {
    const e = obj(raw.estimate);
    const value = amount(raw.estimate !== null && typeof raw.estimate === 'object' ? e.value : raw.estimate);
    estimate = value === null && swarm.estimate ? swarm.estimate
      : value === null ? undefined
      : orderEstimate(value, amount(e.low ?? raw.low), amount(e.high ?? raw.high));
    probability = 0.5;
  }
  const report: Report = {
    headline: text(raw.headline, 120, 'Forecast'),
    answer: '',
    probability,
    swarm: swarm.probability,
    ...(shares ? { shares } : {}),
    ...(estimate ? { estimate } : {}),
    confidence: oneOf(raw.confidence, ['low', 'medium', 'high'] as const, 'medium'),
    summary: text(raw.summary, 1200),
    drivers,
    scenarios,
    signposts,
    dissent: text(raw.dissent, 400),
    caveats: list(raw.caveats, 5).map(c => text(c, 200)).filter(Boolean),
    deviation: text(raw.deviation_reason ?? raw.deviation, 300),
  };
  report.answer = frame ? answerText({ ...emptyFrame, ...frame }, report, null) : `${Math.round(probability * 100)}% YES`;
  return report;
}

/** The fields answerText needs beyond the kind, when a caller has only part of a frame. */
const emptyFrame: Frame = {
  question: '', kind: 'binary', proposition: '', resolution: '', horizon: '', outcomes: [], unit: '',
  baseRate: 0.5, prior: [], anchor: null, baseRateReason: '', focus: null,
};
