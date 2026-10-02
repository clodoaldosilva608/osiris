/**
 * Everything on the globe that can be clicked (an arc, an actor, a panelist,
 * a headline, a scenario, a signpost) resolved back into the piece of the
 * research it stands for. The globe's tooltips and the panel's inspector both
 * read through here, so a click always shows exactly what was drawn.
 *
 * Keys: "link:<link id>" for an arc; "a:<actor>", "g:<panelist>", "c:<item>"
 * for nodes; "s:<index>" and "p:<index>" for the report's scenarios and
 * signposts.
 */
import { postView } from './forecast';
import type { RunState } from './state';
import type { Actor, Agent, ContextItem, Link, Post, Scenario, Signpost } from './types';

export type Selection =
  | { type: 'link'; key: string; link: Link }
  | { type: 'actor'; key: string; actor: Actor }
  | { type: 'agent'; key: string; agent: Agent }
  | { type: 'context'; key: string; item: ContextItem }
  | { type: 'scenario'; key: string; scenario: Scenario; index: number }
  | { type: 'signpost'; key: string; signpost: Signpost; index: number };

export function resolve(s: RunState, key: string | null): Selection | null {
  if (!key) return null;
  if (key.startsWith('link:')) {
    const link = s.links.find(l => l.id === key.slice(5));
    return link ? { type: 'link', key, link } : null;
  }
  const [prefix, ...rest] = key.split(':');
  const id = rest.join(':');
  if (prefix === 'a') { const actor = s.actors.find(a => a.id === id); return actor ? { type: 'actor', key, actor } : null; }
  if (prefix === 'g') { const agent = s.agents.find(a => a.id === id); return agent ? { type: 'agent', key, agent } : null; }
  if (prefix === 'c') { const item = s.context.find(c => c.id === id); return item ? { type: 'context', key, item } : null; }
  if (prefix === 's' && s.report) { const i = Number(id); const scenario = s.report.scenarios[i]; return scenario ? { type: 'scenario', key, scenario, index: i } : null; }
  if (prefix === 'p' && s.report) { const i = Number(id); const signpost = s.report.signposts[i]; return signpost ? { type: 'signpost', key, signpost, index: i } : null; }
  return null;
}

/** The arcs that belong to a selection: the arc itself, or every arc touching a selected node. */
export function relatedLinks(s: RunState, key: string | null): Set<string> {
  const out = new Set<string>();
  if (!key) return out;
  if (key.startsWith('link:')) { out.add(key.slice(5)); return out; }
  for (const l of s.links) if (l.from === key || l.to === key) out.add(l.id);
  return out;
}

/** A node's name, from its key. */
export function nodeName(s: RunState, nodeKey: string): string {
  const [prefix, ...rest] = nodeKey.split(':');
  const id = rest.join(':');
  if (prefix === 'a') return s.actors.find(a => a.id === id)?.name ?? id;
  if (prefix === 'g') return s.agents.find(a => a.id === id)?.name ?? id;
  if (prefix === 'c') return s.context.find(c => c.id === id)?.title ?? id;
  return id;
}

/** The post a link was drawn from: a reply or a focus arc belongs to its panelist's turn in that round. */
export function postFor(s: RunState, link: Link): Post | undefined {
  if (link.kind !== 'reply' && link.kind !== 'focus') return undefined;
  const agent = link.from.slice(2);
  const posts = s.posts.filter(p => p.agent === agent);
  return posts.find(p => p.round === link.round) ?? posts[posts.length - 1];
}

const RELATION_WORD = { support: 'aligned', oppose: 'opposed', neutral: 'linked' } as const;
const STANCE_WORD = { support: 'agrees with', oppose: 'disputes', neutral: 'questions' } as const;
const EFFECT_WORD = { support: 'points toward YES', oppose: 'points toward NO', neutral: 'bears on' } as const;

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/** Two short lines for a tooltip. */
export function brief(s: RunState, key: string): { title: string; detail: string } | null {
  const sel = resolve(s, key);
  if (!sel) return null;
  switch (sel.type) {
    case 'link': {
      const l = sel.link;
      const from = nodeName(s, l.from);
      const to = nodeName(s, l.to);
      if (l.kind === 'relation') return { title: `${from} ⇄ ${to}`, detail: `${RELATION_WORD[l.tone]} · ${clip(l.label, 90)}` };
      if (l.kind === 'evidence') {
        const effect = s.frame?.kind === 'number' ? (l.tone === 'support' ? 'points higher' : l.tone === 'oppose' ? 'points lower' : 'bears on') : EFFECT_WORD[l.tone];
        return { title: clip(from, 80), detail: `${effect}: ${to}` };
      }
      if (l.kind === 'reply') return { title: `${from} ${STANCE_WORD[l.tone]} ${to}`, detail: `Round ${l.round}${l.label ? ` · “${clip(l.label, 80)}”` : ''}` };
      const post = postFor(s, l);
      return { title: `${from} weighing ${to}`, detail: post ? `Round ${post.round} · ${postView(post, s.frame)}` : 'watching' };
    }
    case 'actor': return { title: sel.actor.name, detail: clip(sel.actor.role, 90) };
    case 'agent': {
      const posts = s.posts.filter(p => p.agent === sel.agent.id);
      const last = posts[posts.length - 1];
      return { title: sel.agent.name, detail: `${sel.agent.role}${last ? ` · ${postView(last, s.frame)}` : ''}` };
    }
    case 'context': return { title: clip(sel.item.title, 90), detail: [sel.item.source, sel.item.place].filter(Boolean).join(' · ') };
    case 'scenario': return { title: `Scenario: ${sel.scenario.name}`, detail: `${Math.round(sel.scenario.probability * 100)}% · ${clip(sel.scenario.description, 70)}` };
    case 'signpost': return { title: 'Signpost', detail: clip(sel.signpost.text, 90) };
  }
}
