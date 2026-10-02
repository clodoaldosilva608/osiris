/**
 * A run's state, folded out of its events. The server keeps one per run for
 * snapshots; the panel keeps its own from the same stream.
 */
import type {
  Actor, Agent, ContextItem, Depth, Frame, Link, Phase, Post, Report, RoundStat, RunStatus, Stamped, Usage,
} from './types';

export interface RunState {
  status: RunStatus;
  question: string;
  depth: Depth;
  provider: string;
  model: string;
  agentsPlanned: number;
  roundsPlanned: number;
  phase: Phase;
  phaseLabel: string;
  context: ContextItem[];
  frame: Frame | null;
  actors: Actor[];
  agents: Agent[];
  links: Link[];
  posts: Post[];
  rounds: RoundStat[];
  injects: { text: string; round: number }[];
  report: Report | null;
  usage: Usage;
  warnings: string[];
  /** Why the run stopped, when it failed or was cancelled. */
  message: string;
  /** Agents mid-turn, by id, with the round they are thinking about. */
  thinking: Record<string, number>;
  startedAt: number;
  updatedAt: number;
  lastSeq: number;
}

export function initialState(): RunState {
  return {
    status: 'running',
    question: '',
    depth: 'standard',
    provider: '',
    model: '',
    agentsPlanned: 0,
    roundsPlanned: 0,
    phase: 'context',
    phaseLabel: '',
    context: [],
    frame: null,
    actors: [],
    agents: [],
    links: [],
    posts: [],
    rounds: [],
    injects: [],
    report: null,
    usage: { calls: 0, input: 0, output: 0 },
    warnings: [],
    message: '',
    thinking: {},
    startedAt: 0,
    updatedAt: 0,
    lastSeq: -1,
  };
}

/** The next state. Returns a new object, and leaves `s` untouched. Replayed events (seq already seen) are ignored. */
export function applyEvent(s: RunState, e: Stamped): RunState {
  if (e.seq <= s.lastSeq) return s;
  const n: RunState = { ...s, lastSeq: e.seq, updatedAt: e.at };
  switch (e.t) {
    case 'start':
      n.question = e.question;
      n.depth = e.depth;
      n.provider = e.provider;
      n.model = e.model;
      n.agentsPlanned = e.agents;
      n.roundsPlanned = e.rounds;
      n.startedAt = e.at;
      break;
    case 'phase':
      n.phase = e.phase;
      n.phaseLabel = e.label;
      break;
    case 'context':
      n.context = e.items;
      break;
    case 'frame':
      n.frame = e.frame;
      break;
    case 'actor':
      n.actors = [...s.actors, e.actor];
      break;
    case 'link': {
      // A link drawn again (a panelist re-engaging) replaces the old one and is reborn, so it re-animates.
      const i = s.links.findIndex(l => l.id === e.link.id);
      n.links = i < 0 ? [...s.links, e.link] : [...s.links.slice(0, i), ...s.links.slice(i + 1), e.link];
      break;
    }
    case 'agent':
      n.agents = [...s.agents, e.agent];
      break;
    case 'thinking':
      n.thinking = { ...s.thinking, [e.agent]: e.round };
      break;
    case 'post': {
      n.posts = [...s.posts, e.post];
      const { [e.post.agent]: _done, ...rest } = s.thinking;
      n.thinking = rest;
      break;
    }
    case 'round':
      n.rounds = [...s.rounds, e.stat];
      n.thinking = {};
      break;
    case 'inject':
      n.injects = [...s.injects, { text: e.text, round: e.round }];
      break;
    case 'report':
      n.report = e.report;
      break;
    case 'usage':
      n.usage = e.usage;
      break;
    case 'warn':
      n.warnings = [...s.warnings, e.message].slice(-20);
      break;
    case 'end':
      n.status = e.status;
      n.message = e.message || '';
      n.thinking = {};
      if (e.status === 'done') {
        n.phase = 'done';
        n.phaseLabel = 'Forecast ready';
      }
      break;
  }
  return n;
}

/** The headline number at this point in the run: the report's, else the last round's consensus. */
export function currentProbability(s: RunState): number | null {
  if (s.report) return s.report.probability;
  const last = s.rounds[s.rounds.length - 1];
  return last ? last.consensus : null;
}

/** Each agent's latest post. */
export function latestPosts(s: RunState): Map<string, Post> {
  const out = new Map<string, Post>();
  for (const p of s.posts) out.set(p.agent, p);
  return out;
}
