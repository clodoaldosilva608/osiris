'use client';
/**
 * OSIRIS OI: Forecast or Assist.
 *
 * The two ways to use OI, side by side, each in its own colour so it is never
 * in doubt which one is showing: Forecast is gold (the swarm of forecasters,
 * its report and its arcs); Assist is cyan (the conversation, and everything
 * it marks on the map). Each card says in a line what its mode does, and
 * shows when it is at work: a forecast running, or OI in the middle of a reply.
 */
import { motion } from 'framer-motion';
import { MessageSquare, Orbit } from 'lucide-react';
import { LABEL, T, cyan, gold } from './theme';

export type OiMode = 'forecast' | 'assist';

const MODES: { value: OiMode; label: string; blurb: string; accent: string; tint: (a: number) => string }[] = [
  { value: 'forecast', label: 'Forecast', blurb: 'A swarm of AI forecasters debates your question', accent: T.gold, tint: gold },
  { value: 'assist', label: 'Assist', blurb: 'Talk to OI and it works the map for you', accent: T.cyan, tint: cyan },
];

/** The accent a mode wears everywhere it shows. */
export const modeAccent = (m: OiMode) => (m === 'assist' ? T.cyan : T.gold);

export function ModeSwitch({ id, mode, onMode, forecastLive = false, assistBusy = false, compact = false }: {
  id: string;
  mode: OiMode;
  onMode: (m: OiMode) => void;
  /** A forecast is running. */
  forecastLive?: boolean;
  /** OI is in the middle of a reply. */
  assistBusy?: boolean;
  /** One line per card, for the phone drawer. */
  compact?: boolean;
}) {
  return (
    <div role="tablist" aria-label="How to use OI" className="grid grid-cols-2 gap-1.5">
      {MODES.map(m => {
        const on = mode === m.value;
        const working = m.value === 'forecast' ? forecastLive : assistBusy;
        return (
          <button key={m.value} role="tab" aria-selected={on} onClick={() => onMode(m.value)} title={m.blurb}
            className={`relative overflow-hidden text-left rounded-lg border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${compact ? 'px-2.5 py-1.5' : 'px-3 pt-2 pb-2.5'} ${on ? '' : 'border-[var(--border-secondary)] bg-white/[0.015] hover:bg-[var(--hover-accent)]'}`}
            style={on ? { borderColor: m.tint(0.5), background: m.tint(0.08), boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 0 18px ${m.tint(0.12)}` } : undefined}>
            {on && (
              <motion.span layoutId={`oi-mode-bar-${id}`} transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="absolute inset-x-0 top-0 h-[2px]" style={{ background: m.accent, boxShadow: `0 0 10px ${m.tint(0.8)}` }} />
            )}
            <span className="flex items-center gap-1.5">
              {m.value === 'forecast'
                ? <Orbit className="w-3.5 h-3.5 flex-shrink-0" style={{ color: on ? m.accent : T.mute }} />
                : <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" style={{ color: on ? m.accent : T.mute }} />}
              <span className={`${LABEL} !text-[9.5px] !tracking-[0.2em]`} style={{ color: on ? m.accent : T.body }}>{m.label}</span>
              {working && (
                <span className="ml-auto flex items-center gap-1" title={m.value === 'forecast' ? 'A forecast is running' : 'OI is replying'}>
                  <span className="w-1.5 h-1.5 rounded-full animate-osiris-pulse" style={{ background: m.value === 'forecast' ? T.green : T.cyan, boxShadow: `0 0 6px ${m.value === 'forecast' ? T.green : T.cyan}` }} />
                  {!compact && <span className={`${LABEL} !text-[7.5px]`} style={{ color: m.value === 'forecast' ? T.green : T.cyan }}>{m.value === 'forecast' ? 'Live' : 'Working'}</span>}
                </span>
              )}
            </span>
            {!compact && <span className="block mt-1 text-[10px] leading-snug" style={{ color: on ? T.body : T.mute }}>{m.blurb}</span>}
          </button>
        );
      })}
    </div>
  );
}
