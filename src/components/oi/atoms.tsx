'use client';
/**
 * OSIRIS OI: the small parts every view is built from, in the platform's
 * own idiom (HUD labels, the 3D/2D-style segmented control, layer toggles).
 */
import { createElement, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  Activity, Building2, CandlestickChart, CircleUser, Crown, Eye, Factory, FileText, GitBranch, Landmark, Link2,
  MapPin, MessageSquare, Newspaper, Signpost, TrendingUp, Users, type LucideIcon, type LucideProps,
} from 'lucide-react';
import { leader, outcomeColor, postView } from '@/lib/oi/forecast';
import { mentions } from '@/lib/oi/objects';
import type { RunState } from '@/lib/oi/state';
import type { Frame, LinkKind, Post } from '@/lib/oi/types';
import { LABEL, T, gold, cyan, initials } from './theme';

/** OI's mark in the theme's colours: a core, its ring, and a body in orbit that turns while a run is live. */
export function OiMark({ size = 16, live = false }: { size?: number; live?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className="flex-shrink-0">
      <circle cx="12" cy="12" r="8.5" style={{ stroke: T.gold }} strokeOpacity="0.5" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3" style={{ fill: T.gold }} />
      <g style={{ transformOrigin: '12px 12px', animation: live ? 'spin 3.2s linear infinite' : undefined }}>
        <circle cx="12" cy="3.5" r="2.1" style={{ fill: T.cyan }} />
      </g>
    </svg>
  );
}

export function IconButton({ children, title, onClick, active, disabled }: { children: ReactNode; title: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} disabled={disabled}
      className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--hover-accent)] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 disabled:opacity-30 disabled:pointer-events-none ${active ? 'text-[var(--gold-light)] bg-[var(--hover-accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
      {children}
    </button>
  );
}

export function TextButton({ children, onClick, title, tone, active, disabled }: { children: ReactNode; onClick: () => void; title?: string; tone?: 'danger'; active?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled}
      className={`inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[9px] font-mono tracking-[0.16em] uppercase transition-colors hover:bg-[var(--hover-accent)] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 disabled:opacity-30 disabled:pointer-events-none ${tone === 'danger' ? 'text-[var(--text-muted)] hover:text-[var(--alert-red)]' : active ? 'text-[var(--gold-light)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
      {children}
    </button>
  );
}

/** The platform's toggle switch. */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`layer-toggle ${on ? 'active' : ''}`} />;
}

/** Choices in a row with a sliding highlight, the same control as the map's 3D / 2D switch. */
export function Segmented<V extends string>({ id, options, value, onChange, size = 'md' }: {
  id: string; options: { value: V; label: string; icon?: ReactNode; title?: string }[]; value: V; onChange: (v: V) => void; size?: 'sm' | 'md';
}) {
  return (
    <div role="tablist" className="flex items-center gap-[3px] p-[3px] rounded-lg border border-[var(--border-secondary)] bg-black/40">
      {options.map(o => {
        const on = o.value === value;
        return (
          <button key={o.value} role="tab" aria-selected={on} onClick={() => onChange(o.value)} title={o.title}
            className={`relative flex-1 flex items-center justify-center gap-1.5 ${size === 'sm' ? 'h-6 px-2 text-[8.5px]' : 'h-7 px-3 text-[9.5px]'} rounded-md font-mono font-medium tracking-[0.18em] uppercase whitespace-nowrap transition-colors duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${on ? 'text-[var(--gold-light)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
            {on && (
              <motion.span layoutId={`oi-seg-${id}`} transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="absolute inset-0 rounded-md border border-[var(--border-active)] bg-[var(--gold-primary)]/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_14px_var(--gold-glow)]" />
            )}
            {o.icon && <span className="relative z-10">{o.icon}</span>}
            <span className="relative z-10">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Overline({ children, color }: { children: ReactNode; color?: string }) {
  return <span className={LABEL} style={{ color: color ?? T.mute }}>{children}</span>;
}

export function SectionTitle({ children, count, right }: { children: ReactNode; count?: number; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className={`${LABEL} text-[var(--text-secondary)]`}>{children}</span>
      {count !== undefined && <span className="text-[9px] font-mono tabular-nums text-[var(--cyan-primary)]">{count}</span>}
      <span className="flex-1 h-px bg-[var(--border-secondary)]" />
      {right}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-[11px] leading-relaxed text-[var(--text-muted)]">{children}</p>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex items-center h-4 px-1 rounded border border-[var(--border-primary)] text-[8.5px] font-mono text-[var(--text-muted)] leading-none">{children}</kbd>;
}

export function Avatar({ name, size = 28, ring }: { name: string; size?: number; ring?: 'selected' | 'thinking' }) {
  return (
    <span className="rounded-full flex items-center justify-center font-mono font-medium flex-shrink-0 border"
      style={{
        width: size, height: size, fontSize: size * 0.32, color: T.body, background: 'var(--bg-tertiary)',
        borderColor: ring === 'selected' ? T.gold : ring === 'thinking' ? T.cyan : 'var(--border-primary)',
        boxShadow: ring === 'selected' ? `0 0 0 3px ${gold(0.15)}` : ring === 'thinking' ? `0 0 0 3px ${cyan(0.15)}` : undefined,
      }}>
      {initials(name)}
    </span>
  );
}

/** A panelist's view in figures, with a dot in its outcome's colour for a choice. */
export function ViewTag({ post, frame }: { post: Post; frame: Frame | null }) {
  const lead = frame?.kind === 'choice' && post.shares ? leader(post.shares) : -1;
  return (
    <span className="inline-flex items-center gap-1.5 h-[20px] px-1.5 rounded border border-[var(--border-secondary)] bg-white/[0.03] text-[10px] font-mono tabular-nums whitespace-nowrap text-[var(--text-primary)]">
      {lead >= 0 && <span className="w-1.5 h-1.5 rounded-full" style={{ background: outcomeColor(lead) }} />}
      {postView(post, frame)}
    </span>
  );
}

/* ───────────── Object types ───────────── */

const ACTOR_ICON: Record<string, LucideIcon> = {
  state: Landmark, leader: Crown, organisation: Building2, company: Factory, market: TrendingUp, group: Users, place: MapPin,
};
const SOURCE_ICON: Record<string, LucideIcon> = { news: Newspaper, quake: Activity, market: CandlestickChart };
export const LINK_ICON: Record<LinkKind, LucideIcon> = { relation: Link2, evidence: FileText, reply: MessageSquare, focus: Eye };

/** The icon for an object, from its research key's prefix and its subtype. */
export function iconFor(key: string, subtype = ''): LucideIcon {
  const prefix = key.split(':')[0];
  if (prefix === 'a') return ACTOR_ICON[subtype] ?? Landmark;
  if (prefix === 'g') return CircleUser;
  if (prefix === 'c') return SOURCE_ICON[subtype] ?? Newspaper;
  if (prefix === 's') return GitBranch;
  if (prefix === 'p') return Signpost;
  return Link2;
}

/** An object's icon, by its research key and subtype, or a link's by its kind. */
export function TypeIcon({ k, subtype, link, ...rest }: LucideProps & { k: string; subtype?: string; link?: LinkKind }) {
  return createElement(link ? LINK_ICON[link] : iconFor(k, subtype), rest);
}

/** The accent an object wears: gold for the world, cyan for the panel, the line's own colour for a link. */
export function accentFor(key: string): string {
  const prefix = key.split(':')[0];
  if (prefix === 'g' || prefix === 'p') return T.cyan;
  if (prefix === 'c') return T.body;
  return T.gold;
}

/**
 * Text with the run's actors and panelists in it made clickable: the same
 * sentence a panelist wrote, but "China" opens China.
 */
export function Mentions({ text, s, onSelect }: { text: string; s: RunState; onSelect: (key: string) => void }) {
  const parts = mentions(text, s);
  return (
    <>
      {parts.map((p, i) => typeof p === 'string' ? <span key={i}>{p}</span> : (
        <button key={i} onClick={e => { e.stopPropagation(); onSelect(p.key); }}
          className="text-[var(--text-primary)] underline decoration-dotted decoration-[var(--gold-dim)] underline-offset-2 hover:text-[var(--gold-light)] hover:decoration-[var(--gold-primary)] transition-colors">
          {p.text}
        </button>
      ))}
    </>
  );
}
