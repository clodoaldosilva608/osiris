'use client';
/**
 * OSIRIS OI: choosing an engine (provider, key, model) and asking a question.
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Check, ChevronDown, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { PROVIDERS, providerInfo, type ProviderId } from '@/lib/oi/providers';
import { DEPTHS, estimateCalls } from '@/lib/oi/depths';
import { checkKey, forgetKey, loadKey, saveEngine, saveKey, type Engine } from '@/lib/oi/client';
import type { Depth, Frame } from '@/lib/oi/types';
import { FIELD, KIND_SHORT, LABEL, T, gold, shortName } from './theme';
import { OiMark, Overline, SectionTitle, Segmented, Switch, TextButton } from './atoms';

export function EnginePill({ engine, ready, open, onClick }: { engine: Engine; ready: boolean; open: boolean; onClick: () => void }) {
  const info = providerInfo(engine.provider);
  return (
    <button onClick={onClick} title="Model engine and key" aria-expanded={open}
      className={`mr-1 inline-flex items-center gap-1.5 h-7 pl-2 pr-1.5 rounded-md border text-[9px] font-mono tracking-[0.14em] uppercase transition-colors max-w-[140px] hover:bg-[var(--hover-accent)] ${open ? 'border-[var(--border-active)] text-[var(--gold-light)]' : 'border-[var(--border-secondary)] text-[var(--text-secondary)]'}`}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: ready ? T.green : T.orange, boxShadow: `0 0 6px ${ready ? T.green : T.orange}` }} />
      <span className="truncate">{ready ? shortName(info.name) : 'Add key'}</span>
      <ChevronDown className="w-3 h-3 flex-shrink-0 transition-transform" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
    </button>
  );
}

export function EngineSheet({ engine, setEngine, keyValue, setKey, onDone }: {
  engine: Engine; setEngine: (e: Engine) => void; keyValue: string; setKey: (k: string) => void; onDone: () => void;
}) {
  const info = providerInfo(engine.provider);
  const [reveal, setReveal] = useState(false);
  const [models, setModels] = useState<{ id: string; name: string }[] | null>(null);
  const [status, setStatus] = useState<{ kind: 'idle' | 'checking' | 'ok' | 'error'; text: string }>({ kind: 'idle', text: '' });
  const [filter, setFilter] = useState('');

  const pickProvider = (id: ProviderId) => {
    const next = { ...engine, provider: id, model: providerInfo(id).defaultModel };
    setEngine(next);
    saveEngine(next);
    setKey(loadKey(id));
    setModels(null);
    setStatus({ kind: 'idle', text: '' });
  };

  const check = async () => {
    setStatus({ kind: 'checking', text: '' });
    saveKey(engine.provider, keyValue, engine.remember);
    const out = await checkKey(engine.provider, keyValue);
    if ('error' in out) { setStatus({ kind: 'error', text: out.error }); return; }
    setModels(out.models);
    const model = out.models.some(m => m.id === engine.model) ? engine.model : out.preferred || engine.model;
    const next = { ...engine, model };
    setEngine(next);
    saveEngine(next);
    setStatus({ kind: 'ok', text: `Key accepted · ${out.models.length} model${out.models.length === 1 ? '' : 's'} available` });
  };

  const shown = useMemo(() => {
    const list = models ?? info.suggested.map(id => ({ id, name: id }));
    const f = filter.trim().toLowerCase();
    const hit = f ? list.filter(m => m.id.toLowerCase().includes(f) || m.name.toLowerCase().includes(f)) : list;
    return hit.some(m => m.id === engine.model) ? hit : [{ id: engine.model, name: engine.model }, ...hit];
  }, [models, info.suggested, filter, engine.model]);

  const ready = !info.needsKey || keyValue.length > 0;

  return (
    <section className="px-4 py-4 border-b border-[var(--border-secondary)] flex flex-col gap-4" style={{ background: gold(0.025) }}>
      <div>
        <SectionTitle right={ready ? <TextButton onClick={onDone}>Done</TextButton> : undefined}>Engine · your own key</SectionTitle>
        <div className="grid grid-cols-3 gap-1">
          {PROVIDERS.map(p => {
            const on = engine.provider === p.id;
            return (
              <button key={p.id} onClick={() => pickProvider(p.id)} title={p.name} aria-pressed={on}
                className={`h-8 px-1.5 rounded-md border text-[9px] font-mono tracking-[0.1em] uppercase truncate transition-colors ${on ? 'border-[var(--border-active)] bg-[var(--gold-primary)]/10 text-[var(--gold-light)]' : 'border-[var(--border-secondary)] bg-white/[0.02] text-[var(--text-secondary)] hover:bg-[var(--hover-accent)] hover:text-[var(--text-primary)]'}`}>
                {shortName(p.name)}
              </button>
            );
          })}
        </div>
      </div>

      {info.needsKey ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <KeyRound className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type={reveal ? 'text' : 'password'} value={keyValue} onChange={e => { setKey(e.target.value.trim()); setStatus({ kind: 'idle', text: '' }); }}
                placeholder={`${info.name} key  ${info.keyHint}`} autoComplete="off" spellCheck={false}
                data-1p-ignore data-lpignore="true" aria-label={`${info.name} API key`}
                className={`${FIELD} h-8 pl-7 pr-8 text-[11px] font-mono`}
              />
              <button onClick={() => setReveal(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white" aria-label={reveal ? 'Hide key' : 'Show key'}>
                {reveal ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
            <button onClick={check} disabled={!keyValue || status.kind === 'checking'} className="btn-tactical h-8 disabled:opacity-40 disabled:pointer-events-none" style={{ padding: '0 14px', fontSize: 10 }}>
              {status.kind === 'checking' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Check'}
            </button>
          </div>
          {status.text && (
            <p role="status" className="text-[10.5px] flex items-center gap-1.5" style={{ color: status.kind === 'error' ? T.red : T.green }}>
              {status.kind === 'ok' && <Check className="w-3 h-3" />}{status.text}
            </p>
          )}
          <div className="flex items-center gap-3 text-[10.5px]">
            <label className="flex items-center gap-2 cursor-pointer text-[var(--text-secondary)]">
              <Switch on={engine.remember} label="Remember the key on this device" onChange={on => {
                const next = { ...engine, remember: on };
                setEngine(next); saveEngine(next); saveKey(engine.provider, keyValue, on);
              }} />
              Remember on this device
            </label>
            <a href={info.keyUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-[var(--text-muted)] hover:text-[var(--gold-light)]">Get a key ↗</a>
            {keyValue && <button onClick={() => { forgetKey(engine.provider); setKey(''); setModels(null); setStatus({ kind: 'idle', text: '' }); }} className="text-[var(--text-muted)] hover:text-[var(--alert-red)]">Forget</button>}
          </div>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">Scripted answers for trying the pipeline on a development server. No key, no cost, no real analysis.</p>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Overline>Model</Overline>
          {(models?.length ?? 0) > 12 && (
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter" aria-label="Filter models" className={`${FIELD} ml-auto !w-32 h-6 px-2 text-[10px]`} />
          )}
        </div>
        <select value={engine.model} onChange={e => { const next = { ...engine, model: e.target.value }; setEngine(next); saveEngine(next); }} aria-label="Model"
          className={`${FIELD} h-8 px-2 text-[11px] font-mono`}>
          {shown.map(m => <option key={m.id} value={m.id} style={{ background: '#0C0E1A' }}>{m.name === m.id ? m.id : `${m.name} (${m.id})`}</option>)}
        </select>
        {!models && info.needsKey && <p className="text-[10px] text-[var(--text-muted)]">Check the key to list every model it can use.</p>}
      </div>

      {info.needsKey && (
        <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
          Your key stays in this browser{engine.remember ? '' : ' tab'} and reaches OSIRIS only inside your requests, which pass it to {info.name} for your run. It is never stored on the server or logged. A forecast makes about 15 to 70 model calls, billed to your {info.name} account.
        </p>
      )}
    </section>
  );
}

const EXAMPLES: { kind: Frame['kind']; text: string }[] = [
  { kind: 'binary', text: 'Will Russia and Ukraine agree a ceasefire before 1 July 2027?' },
  { kind: 'choice', text: 'Which way will the US Federal Reserve move rates at its next meeting: cut, hold or hike?' },
  { kind: 'number', text: 'Where will Brent crude settle on 31 December 2026, in USD a barrel?' },
];

export function AskForm({ ready, providerName, onRun, onKey }: { ready: boolean; providerName: string; onKey: () => void; onRun: (input: { question: string; seed: string; depth: Depth; useFeeds: boolean }) => Promise<boolean> }) {
  const [question, setQuestion] = useState('');
  const [seed, setSeed] = useState('');
  const [showSeed, setShowSeed] = useState(false);
  const [depth, setDepth] = useState<Depth>('standard');
  const [useFeeds, setUseFeeds] = useState(true);
  const [starting, setStarting] = useState(false);
  const valid = question.trim().length >= 8;
  const run = async () => {
    if (!ready || !valid || starting) return;
    setStarting(true);
    const ok = await onRun({ question: question.trim(), seed, depth, useFeeds });
    setStarting(false);
    if (ok) { setQuestion(''); setSeed(''); }
  };
  const d = DEPTHS[depth];
  return (
    <section className="px-4 pt-4 pb-4 flex flex-col gap-4">
      <div>
        <h3 className="text-[13px] font-semibold tracking-wide text-[var(--text-heading)]">Ask the panel</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
          A simulated panel of forecasters debates your question in rounds, grounded in live OSIRIS intelligence, while the analysis draws itself on the globe.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <textarea
          value={question} onChange={e => setQuestion(e.target.value.slice(0, 500))} rows={3}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void run(); }}
          placeholder="What do you want to know?" aria-label="Your question"
          className={`${FIELD} rounded-lg resize-none px-3 py-2.5 text-[12.5px] leading-relaxed`}
        />
        {!question && (
          <div className="flex flex-col divide-y divide-[var(--border-secondary)]">
            {EXAMPLES.map(x => (
              <button key={x.text} onClick={() => setQuestion(x.text)} className="group flex items-center gap-2.5 py-1.5 text-left">
                <span className={`w-[58px] flex-shrink-0 ${LABEL} !text-[8.5px] text-[var(--text-muted)]`}>{KIND_SHORT[x.kind]}</span>
                <span className="flex-1 text-[11px] leading-snug truncate text-[var(--text-secondary)] transition-colors group-hover:text-[var(--text-primary)]">{x.text}</span>
                <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--gold-primary)]" />
              </button>
            ))}
          </div>
        )}
        <button onClick={() => setShowSeed(!showSeed)} aria-expanded={showSeed} className="self-start flex items-center gap-1.5 text-[10.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          <ChevronDown className="w-3 h-3 transition-transform" style={{ transform: showSeed ? 'rotate(180deg)' : undefined }} />
          Add your own material{seed && ` · ${seed.length.toLocaleString()} characters`}
        </button>
        <AnimatePresence initial={false}>
          {showSeed && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <textarea value={seed} onChange={e => setSeed(e.target.value.slice(0, 20_000))} rows={5} aria-label="Your material"
                placeholder="Paste a report, notes or a draft. The panel reads it alongside the live feeds."
                className={`${FIELD} rounded-lg resize-y px-3 py-2.5 text-[11px] leading-relaxed`} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Overline>Depth</Overline>
          <span className="text-[9px] font-mono tracking-[0.1em] text-[var(--text-muted)]">{d.agents} FORECASTERS · {d.rounds} ROUNDS · ~{estimateCalls(depth)} CALLS</span>
        </div>
        <Segmented id="depth" value={depth} onChange={setDepth} options={(Object.keys(DEPTHS) as Depth[]).map(k => ({ value: k, label: DEPTHS[k].label }))} />
      </div>

      <div className="flex items-center gap-3 rounded-md border border-[var(--border-secondary)] bg-white/[0.015] px-3 py-2">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[var(--text-primary)]">Live intelligence</p>
          <p className="text-[10px] text-[var(--text-muted)] truncate">Ground the panel in OSIRIS news, quakes and markets</p>
        </div>
        <Switch on={useFeeds} onChange={setUseFeeds} label="Ground it in the live OSIRIS feeds" />
      </div>

      {ready ? (
        <button onClick={run} disabled={!valid || starting} className="btn-tactical w-full flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none" style={{ color: 'var(--gold-light)' }}>
          {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <OiMark size={14} />}
          Run forecast
        </button>
      ) : (
        <button onClick={onKey} className="btn-tactical btn-tactical--cyan w-full">Add your {shortName(providerName)} key to start</button>
      )}

      <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
        Answers take the shape of the question: a probability, a share for each outcome, or an estimate with a range. Method after{' '}
        <a href="https://github.com/666ghj/MiroFish" target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-[var(--gold-light)]">MiroFish</a>; also on the{' '}
        <a href="/docs#oi" className="underline decoration-dotted underline-offset-2 hover:text-[var(--gold-light)]">API and MCP</a>. A simulation, not a guarantee.
      </p>
    </section>
  );
}
