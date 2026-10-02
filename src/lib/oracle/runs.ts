/**
 * Runs in flight and recently finished, held in this process's memory.
 *
 * - A run is public to anyone holding its id (a random UUID), so it can be
 *   shared and watched. Changing it (injecting an event, cancelling) needs the
 *   run token handed only to whoever started it.
 * - The visitor's key lives in the closure of the run's chat function and
 *   nowhere else. It is not on the record, so it goes when the run ends.
 * - Limits keep one visitor, or everyone at once, from tying the server up.
 *
 * The store hangs off globalThis so every route bundle (and a dev reload)
 * sees the same runs.
 */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DEPTHS, FatalError, runEngine } from './engine';
import { createChat, providerInfo, scrub, type ChatFn, type ProviderId } from './providers';
import { applyEvent, initialState, type RunState } from './state';
import { text } from './parse';
import type { ContextItem, Depth, OracleEvent, Stamped } from './types';

export const LIMITS = {
  /** Runs one address may have going at once. */
  perIpActive: 2,
  /** Runs one address may start per window. */
  perIpStarts: 8,
  windowMs: 10 * 60_000,
  /** Runs the whole server will have going at once. */
  globalActive: Number(process.env.ORACLE_MAX_ACTIVE) || 24,
  /** Runs kept in memory, finished ones evicted oldest first. */
  maxRuns: 150,
  /** How long a finished run stays watchable. */
  ttlMs: 3 * 3_600_000,
  maxEvents: 4000,
  maxInjects: 8,
  /** A run that is still going after this is stopped. */
  deadlineMs: 20 * 60_000,
};

export interface Run {
  id: string;
  token: string;
  ip: string;
  createdAt: number;
  finishedAt: number | null;
  events: Stamped[];
  state: RunState;
  listeners: Set<(e: Stamped) => void>;
  abort: AbortController;
  injects: string[];
  injectCount: number;
}

interface Store {
  runs: Map<string, Run>;
  starts: Map<string, number[]>;
}

const g = globalThis as unknown as { __osirisOracle?: Store };
const store: Store = (g.__osirisOracle ??= { runs: new Map(), starts: new Map() });

export interface StartInput {
  question: string;
  seed: string;
  depth: Depth;
  useFeeds: boolean;
  provider: ProviderId;
  model: string;
  key: string;
  ip: string;
}

export interface StartDeps {
  /** For tests: a chat function in place of the provider's. */
  chat?: ChatFn;
  gather?: (question: string, seed: string, limit: number) => Promise<ContextItem[]>;
  concurrency?: number;
}

export type StartResult = { ok: true; run: Run } | { ok: false; status: number; error: string };

const active = (r: Run) => r.state.status === 'running';

/** The abort reason a cancel uses, to tell it apart from a failure. */
const CANCELLED = Symbol('cancelled');

function prune(now = Date.now()) {
  for (const [id, r] of store.runs) {
    if (r.finishedAt && now - r.finishedAt > LIMITS.ttlMs) store.runs.delete(id);
  }
  if (store.runs.size > LIMITS.maxRuns) {
    const finished = [...store.runs.values()].filter(r => r.finishedAt).sort((a, b) => a.finishedAt! - b.finishedAt!);
    for (const r of finished.slice(0, store.runs.size - LIMITS.maxRuns)) store.runs.delete(r.id);
  }
  for (const [ip, times] of store.starts) {
    const kept = times.filter(t => now - t < LIMITS.windowMs);
    if (kept.length) store.starts.set(ip, kept);
    else store.starts.delete(ip);
  }
}

/** Events that may be dropped once a run's log is full. The ones that matter are always kept. */
const DROPPABLE = new Set(['thinking', 'warn', 'link', 'usage']);

function emit(run: Run, e: OracleEvent) {
  const stamped = { ...e, seq: run.state.lastSeq + 1, at: Date.now() } as Stamped;
  if (run.events.length >= LIMITS.maxEvents && DROPPABLE.has(e.t)) return;
  run.events.push(stamped);
  run.state = applyEvent(run.state, stamped);
  for (const l of run.listeners) {
    try { l(stamped); } catch { /* a listener's failure is its own */ }
  }
}

export function startRun(input: StartInput, deps: StartDeps = {}): StartResult {
  const now = Date.now();
  prune(now);
  const runs = [...store.runs.values()];
  if (runs.filter(active).length >= LIMITS.globalActive) {
    return { ok: false, status: 503, error: 'The Oracle is at capacity. Try again in a few minutes.' };
  }
  if (runs.filter(r => active(r) && r.ip === input.ip).length >= LIMITS.perIpActive) {
    return { ok: false, status: 429, error: `You already have ${LIMITS.perIpActive} runs going. Wait for one to finish or cancel it.` };
  }
  const starts = store.starts.get(input.ip) ?? [];
  if (starts.length >= LIMITS.perIpStarts) {
    return { ok: false, status: 429, error: 'Too many runs started from your address. Try again in a few minutes.' };
  }
  store.starts.set(input.ip, [...starts, now]);

  const run: Run = {
    id: randomUUID(),
    token: randomBytes(24).toString('base64url'),
    ip: input.ip,
    createdAt: now,
    finishedAt: null,
    events: [],
    state: initialState(),
    listeners: new Set(),
    abort: new AbortController(),
    injects: [],
    injectCount: 0,
  };
  store.runs.set(run.id, run);

  const depth = DEPTHS[input.depth];
  emit(run, { t: 'start', question: input.question, depth: input.depth, provider: input.provider, model: input.model, agents: depth.agents, rounds: depth.rounds });

  const chat = deps.chat ?? createChat(input.provider, input.key, input.model);
  const key = input.key;
  const deadline = setTimeout(() => run.abort.abort(new Error('The run took too long and was stopped.')), LIMITS.deadlineMs);

  void runEngine(
    { question: input.question, seed: input.seed, depth: input.depth, useFeeds: input.useFeeds },
    {
      chat,
      concurrency: deps.concurrency ?? providerInfo(input.provider).concurrency,
      emit: e => emit(run, e),
      signal: run.abort.signal,
      takeInjects: () => run.injects.splice(0),
      gather: deps.gather,
    },
  ).then(
    () => emit(run, { t: 'end', status: 'done' }),
    (err: unknown) => {
      const reason = run.abort.signal.reason;
      if (run.abort.signal.aborted && reason === CANCELLED) {
        emit(run, { t: 'end', status: 'cancelled', message: 'Cancelled.' });
        return;
      }
      const raw = run.abort.signal.aborted && reason instanceof Error ? reason.message
        : err instanceof FatalError || err instanceof Error ? err.message : 'The run failed.';
      emit(run, { t: 'end', status: 'failed', message: scrub(raw, key).slice(0, 300) });
    },
  ).finally(() => {
    clearTimeout(deadline);
    run.finishedAt = Date.now();
    run.injects = [];
    // Watchers are told by the 'end' event; nothing more will come.
    run.listeners.clear();
  });

  return { ok: true, run };
}

export function getRun(id: string): Run | undefined {
  prune();
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? store.runs.get(id) : undefined;
}

/** True when `token` is this run's token, compared in constant time. */
export function ownsRun(run: Run, token: unknown): boolean {
  if (typeof token !== 'string' || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(run.token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cancelRun(run: Run): boolean {
  if (!active(run)) return false;
  run.abort.abort(CANCELLED);
  return true;
}

export type InjectResult = { ok: true } | { ok: false; status: number; error: string };

/** Queue an event for the panel to take up at the start of its next round. */
export function injectEvent(run: Run, raw: unknown): InjectResult {
  const t = text(raw, 400);
  if (t.length < 3) return { ok: false, status: 400, error: 'Describe the event in a few words.' };
  if (!active(run)) return { ok: false, status: 409, error: 'This run has finished.' };
  if (run.state.phase === 'report') return { ok: false, status: 409, error: 'The report is being written; it is too late to inject.' };
  if (run.injectCount >= LIMITS.maxInjects) return { ok: false, status: 429, error: `At most ${LIMITS.maxInjects} events per run.` };
  run.injectCount++;
  run.injects.push(t);
  return { ok: true };
}

/** Replays events after `after`, then follows the run live. Returns the unsubscribe. */
export function subscribe(run: Run, after: number, listener: (e: Stamped) => void): () => void {
  for (const e of run.events) if (e.seq > after) listener(e);
  if (!active(run)) return () => {};
  run.listeners.add(listener);
  return () => { run.listeners.delete(listener); };
}

const MAX_WAITS_PER_IP = 6;
const waits = ((globalThis as unknown as { __osirisOracleWaits?: Map<string, number> }).__osirisOracleWaits ??= new Map());

/**
 * A slot for one held-open wait (a long-poll, an MCP call waiting on a run),
 * or null when this address already holds its share. Call the returned
 * function to give the slot back. Without this, one client could park
 * hundreds of connections on the server, each waiting minutes.
 */
export function waitSlot(ip: string): (() => void) | null {
  const n = waits.get(ip) ?? 0;
  if (n >= MAX_WAITS_PER_IP) return null;
  waits.set(ip, n + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (waits.get(ip) ?? 1) - 1;
    if (left > 0) waits.set(ip, left);
    else waits.delete(ip);
  };
}

/** Resolves when the run ends, the time is up, or `signal` aborts. */
export function waitForEnd(run: Run, ms: number, signal?: AbortSignal): Promise<void> {
  if (!active(run) || ms <= 0) return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const unsubscribe = subscribe(run, run.state.lastSeq, e => { if (e.t === 'end') finish(); });
    signal?.addEventListener('abort', finish, { once: true });
  });
}

/* ───────────────────────────── Views ───────────────────────────── */

const pct = (p: number | null | undefined) => (typeof p === 'number' && Number.isFinite(p) ? Math.round(p * 1000) / 10 : null);

/** A compact, JSON-ready account of a run: what an API caller or an MCP client reads. */
export function runSummary(run: Run, origin: string) {
  const s = run.state;
  const last = s.rounds[s.rounds.length - 1];
  const latest = new Map(s.posts.map(p => [p.agent, p]));
  return {
    id: run.id,
    status: s.status,
    phase: s.phase,
    phase_label: s.phaseLabel,
    message: s.message || undefined,
    question: s.question,
    depth: s.depth,
    provider: s.provider,
    model: s.model,
    watch_url: watchUrl(origin, run.id),
    probability_pct: pct(s.report?.probability ?? last?.consensus),
    proposition: s.frame?.proposition,
    resolution: s.frame?.resolution,
    horizon: s.frame?.horizon || undefined,
    base_rate_pct: pct(s.frame?.baseRate),
    progress: {
      rounds_done: s.rounds.length,
      rounds_planned: s.roundsPlanned,
      agents: s.agents.length,
      posts: s.posts.length,
      actors: s.actors.length,
      links: s.links.length,
      context_items: s.context.length,
    },
    rounds: s.rounds.map(r => ({ round: r.round, consensus_pct: pct(r.consensus), median_pct: pct(r.median), p25_pct: pct(r.p25), p75_pct: pct(r.p75), n: r.n })),
    report: s.report ? {
      headline: s.report.headline,
      probability_pct: pct(s.report.probability),
      swarm_pct: pct(s.report.swarm),
      confidence: s.report.confidence,
      summary: s.report.summary,
      drivers: s.report.drivers,
      scenarios: s.report.scenarios.map(x => ({ ...x, probability_pct: pct(x.probability) })),
      signposts: s.report.signposts,
      dissent: s.report.dissent,
      caveats: s.report.caveats,
      deviation: s.report.deviation || undefined,
    } : null,
    actors: s.actors.map(a => ({ id: a.id, name: a.name, kind: a.kind, place: a.place, lat: a.lat, lng: a.lng, role: a.role, lean: a.lean })),
    panel: s.agents.map(a => {
      const p = latest.get(a.id);
      return { id: a.id, name: a.name, role: a.role, place: a.place, probability_pct: pct(p?.probability ?? null), last_post: p?.text };
    }),
    injected: s.injects,
    usage: s.usage,
    warnings: s.warnings.length ? s.warnings : undefined,
    started_at: new Date(s.startedAt || run.createdAt).toISOString(),
    updated_at: new Date(s.updatedAt || run.createdAt).toISOString(),
  };
}

export function watchUrl(origin: string, id: string): string {
  return `${origin}/?oracle=${id}`;
}
