/**
 * OSIRIS Oracle: the types the engine, the API, the MCP server and the panel share.
 *
 * A run is a stream of events. Everything a viewer sees (the panel, the arcs on
 * the globe, the API snapshot, an MCP tool result) is folded out of the same
 * events by `applyEvent` in ./state, so the views cannot disagree.
 */

export type Depth = 'quick' | 'standard' | 'deep';

export type Phase = 'context' | 'graph' | 'agents' | 'simulate' | 'report' | 'done';

export type RunStatus = 'running' | 'done' | 'failed' | 'cancelled';

/** A point on Earth, or none: a node the model could not place stays off the globe. */
export interface Located {
  place: string;
  lat: number | null;
  lng: number | null;
}

/** The question, pinned down to something that will resolve YES or NO. */
export interface Frame {
  question: string;
  proposition: string;
  /** How a reader will judge YES. */
  resolution: string;
  /** YYYY-MM-DD, or '' when the question has no natural date. */
  horizon: string;
  baseRate: number;
  baseRateReason: string;
  focus: Located | null;
}

/** One piece of the live world the run was given: a headline, a quake, the markets. */
export interface ContextItem extends Located {
  id: string;
  kind: 'news' | 'quake' | 'market';
  title: string;
  source: string;
  /** ISO time, or '' */
  published: string;
}

export type ActorKind = 'state' | 'leader' | 'organisation' | 'company' | 'market' | 'group' | 'place';

/** Something in the world that will shape the outcome. */
export interface Actor extends Located {
  id: string;
  name: string;
  kind: ActorKind;
  role: string;
  /** −1 pushes toward NO, +1 toward YES. */
  lean: number;
}

/** A simulated forecaster on the panel. Fictional people, real places. */
export interface Agent extends Located {
  id: string;
  name: string;
  role: string;
  /** How they reason. */
  lens: string;
  bias: string;
  prior: number;
  /** Actor ids they follow. */
  watches: string[];
}

/**
 * An arc. Node keys are prefixed by what they point at:
 * `a:` an actor, `g:` an agent, `c:` a context item.
 */
export type LinkKind = 'relation' | 'evidence' | 'reply' | 'focus';
export type Tone = 'support' | 'oppose' | 'neutral';

export interface Link {
  id: string;
  from: string;
  to: string;
  kind: LinkKind;
  tone: Tone;
  /** 0..1 */
  strength: number;
  label: string;
  /** 0 for the world model, else the simulation round that drew it. */
  round: number;
}

export interface Reply {
  to: string;
  stance: 'agree' | 'disagree' | 'question';
  point: string;
}

/** One agent's turn in one round. */
export interface Post {
  id: string;
  agent: string;
  round: number;
  probability: number;
  confidence: number;
  text: string;
  reasoning: string;
  changed: string;
  replies: Reply[];
  focus: string[];
}

/** Where the panel stood at the end of a round. */
export interface RoundStat {
  round: number;
  /** Confidence-weighted pool of the panel's log-odds. */
  consensus: number;
  median: number;
  mean: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
  /** p75 − p25 */
  spread: number;
  n: number;
  /** Ten bins, 0–10% … 90–100%. */
  histogram: number[];
}

export interface Driver {
  text: string;
  push: 'yes' | 'no';
  weight: number;
  actor: string | null;
}

export interface Scenario extends Located {
  name: string;
  probability: number;
  description: string;
}

export interface Signpost extends Located {
  text: string;
  means: 'yes' | 'no';
}

export interface Report {
  headline: string;
  /** The report agent's calibrated number. */
  probability: number;
  /** The panel's own consensus after the last round. */
  swarm: number;
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  drivers: Driver[];
  scenarios: Scenario[];
  signposts: Signpost[];
  dissent: string;
  caveats: string[];
  /** Why the report moved away from the panel, when it did. */
  deviation: string;
}

export interface Usage {
  calls: number;
  input: number;
  output: number;
}

export type OracleEvent =
  | { t: 'start'; question: string; depth: Depth; provider: string; model: string; agents: number; rounds: number }
  | { t: 'phase'; phase: Phase; label: string }
  | { t: 'context'; items: ContextItem[] }
  | { t: 'frame'; frame: Frame }
  | { t: 'actor'; actor: Actor }
  | { t: 'link'; link: Link }
  | { t: 'agent'; agent: Agent }
  | { t: 'thinking'; agent: string; round: number }
  | { t: 'post'; post: Post }
  | { t: 'round'; stat: RoundStat }
  | { t: 'inject'; text: string; round: number }
  | { t: 'report'; report: Report }
  | { t: 'usage'; usage: Usage }
  | { t: 'warn'; message: string }
  | { t: 'end'; status: Exclude<RunStatus, 'running'>; message?: string };

/** An event as stored and streamed: numbered, and timed in ms since the epoch. */
export type Stamped = OracleEvent & { seq: number; at: number };
