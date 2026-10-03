/**
 * OSIRIS OI: the types the engine, the API, the MCP server and the panel share.
 *
 * A run is a stream of events. Everything a viewer sees (the panel, the arcs on
 * the globe, the API snapshot, an MCP tool result) is folded out of the same
 * events by `applyEvent` in ./state, so the views cannot disagree.
 */

export type Depth = 'quick' | 'standard' | 'deep';

export type Phase = 'context' | 'graph' | 'agents' | 'simulate' | 'report' | 'done';

export type RunStatus = 'running' | 'done' | 'failed' | 'cancelled';

/**
 * What kind of answer the question wants.
 *   binary  will it happen: a probability of YES
 *   choice  which of a few named outcomes: a share for each
 *   number  how much: an estimate with an 80% range
 */
export type ForecastKind = 'binary' | 'choice' | 'number';

/** A number with its 80% range. */
export interface Estimate {
  value: number;
  low: number;
  high: number;
}

/** A point on Earth, or none: a node the model could not place stays off the globe. */
export interface Located {
  place: string;
  lat: number | null;
  lng: number | null;
}

/** The question, pinned down to something that will resolve. */
export interface Frame {
  question: string;
  kind: ForecastKind;
  /** binary: the YES/NO statement. choice and number: the exact question. */
  proposition: string;
  /** How a reader will judge the outcome. */
  resolution: string;
  /** YYYY-MM-DD, or '' when the question has no natural date. */
  horizon: string;
  /** choice: the mutually exclusive outcomes, in order. Empty otherwise. */
  outcomes: string[];
  /** number: the unit the answer is in, e.g. "USD per barrel". */
  unit: string;
  /** binary: the base rate of YES. */
  baseRate: number;
  /** choice: the prior share of each outcome, summing to 1. */
  prior: number[];
  /** number: the current or reference value, when there is one. */
  anchor: number | null;
  /** The reference class or reading behind the prior. */
  baseRateReason: string;
  focus: Located | null;
}

/**
 * A source the run was given: a piece of the live world (a headline, a quake,
 * the markets), or a passage of the asker's own data (`data`: ids d1, d2…,
 * or `data` for the whole of it when the panel reads it all).
 */
export interface ContextItem extends Located {
  id: string;
  kind: 'news' | 'quake' | 'market' | 'data';
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
 * `a:` an actor, `g:` an agent, `c:` a context item, `r:report` the report.
 * A `cite` runs from a panelist (or the report) to the source it quotes.
 */
export type LinkKind = 'relation' | 'evidence' | 'reply' | 'focus' | 'cite';
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

/** Words a panelist quoted, and the source they came from. */
export interface Citation {
  /** The source's id: a feed item (c3), a passage of the asker's data (d2), or `data`. */
  source: string;
  quote: string;
  /** The words were found in the source as quoted. */
  exact: boolean;
}

/** One agent's turn in one round. */
export interface Post {
  id: string;
  agent: string;
  round: number;
  /** binary: P(YES). choice: the share given to their leading pick. number: 0.5, unused. */
  probability: number;
  /** choice: their share for each outcome, in the frame's order, summing to 1. */
  shares?: number[];
  /** number: their estimate and 80% range. */
  estimate?: Estimate;
  confidence: number;
  text: string;
  reasoning: string;
  changed: string;
  replies: Reply[];
  focus: string[];
  /** What the post quotes, by source. Missing from runs made before quoting. */
  cites?: Citation[];
}

/**
 * Where the panel stood at the end of a round. The scalar fields describe a
 * binary question's P(YES), and a choice question's share for its leader;
 * a number question carries its figures in `value`.
 */
export interface RoundStat {
  round: number;
  /** binary: the confidence-weighted pool of the panel's log-odds. choice: the leader's pooled share. */
  consensus: number;
  /** choice: the pooled share of every outcome, summing to 1. */
  shares?: number[];
  /** choice: how many panelists put each outcome first. */
  votes?: number[];
  /** number: the panel's estimates. low and high are the medians of the panelists' own ranges. */
  value?: { median: number; p25: number; p75: number; min: number; max: number; low: number; high: number };
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
  /** binary: toward YES or NO. number: up or down. choice: see `favors`. */
  push: 'yes' | 'no';
  /** choice: the outcome this helps. */
  favors: string;
  weight: number;
  actor: string | null;
  /** The ids of the sources it rests on. */
  sources?: string[];
}

export interface Scenario extends Located {
  name: string;
  probability: number;
  description: string;
}

export interface Signpost extends Located {
  text: string;
  /** As for drivers: YES/NO, or up/down for a number. */
  means: 'yes' | 'no';
  /** choice: the outcome it would point to. */
  favors: string;
}

export interface Report {
  headline: string;
  /** The answer in a phrase: "62% YES", "Lula (45%)", "86.4 USD per barrel (80–92)". */
  answer: string;
  /** binary: the calibrated P(YES). choice: the leader's calibrated share. number: 0.5, unused. */
  probability: number;
  /** The panel's own figure after the last round, on the same footing as `probability`. */
  swarm: number;
  /** choice: the calibrated share of every outcome. */
  shares?: number[];
  /** number: the calibrated estimate. */
  estimate?: Estimate;
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

export type OiEvent =
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
export type Stamped = OiEvent & { seq: number; at: number };
