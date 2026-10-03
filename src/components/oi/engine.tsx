'use client';
/**
 * OSIRIS OI: choosing an engine (provider, key, model) and asking a question.
 */
import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Check, ChevronDown, Database, Eye, EyeOff, FileText, KeyRound, Loader2, Upload, X } from 'lucide-react';
import { PROVIDERS, providerInfo, type ProviderId } from '@/lib/oi/providers';
import { DEPTHS, PANEL_SEED_MAX, SEED_MAX, estimateCalls, seedCost, type SeedScope } from '@/lib/oi/depths';
import { checkKey, forgetKey, loadKey, saveEngine, saveKey, type Engine } from '@/lib/oi/client';
import type { Depth, Frame } from '@/lib/oi/types';
import { FIELD, KIND_SHORT, LABEL, T, gold, shortName } from './theme';
import { OiMark, Overline, SectionTitle, Segmented, Switch, TextButton } from './atoms';
import { ModelPicker } from './ModelPicker';

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
  const [listed, setListed] = useState(false);
  const [status, setStatus] = useState<{ kind: 'idle' | 'checking' | 'ok' | 'error'; text: string }>({ kind: 'idle', text: '' });

  const pickProvider = (id: ProviderId) => {
    const next = { ...engine, provider: id, model: providerInfo(id).defaultModel };
    setEngine(next);
    saveEngine(next);
    setKey(loadKey(id));
    setModels(null);
    setListed(false);
    setStatus({ kind: 'idle', text: '' });
  };

  const check = async () => {
    setStatus({ kind: 'checking', text: '' });
    saveKey(engine.provider, keyValue, engine.remember);
    const out = await checkKey(engine.provider, keyValue);
    if ('error' in out) { setStatus({ kind: 'error', text: out.error }); return; }
    setModels(out.models);
    setListed(out.listed);
    const model = out.models.some(m => m.id === engine.model) ? engine.model : out.preferred || engine.model;
    const next = { ...engine, model };
    setEngine(next);
    saveEngine(next);
    setStatus({ kind: 'ok', text: `Key accepted · ${out.models.length} model${out.models.length === 1 ? '' : 's'} available` });
  };

  const setModel = (model: string) => {
    const next = { ...engine, model };
    setEngine(next);
    saveEngine(next);
  };

  const known = useMemo(() => info.suggested.map(id => ({ id, name: id })), [info.suggested]);
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
            {keyValue && <button onClick={() => { forgetKey(engine.provider); setKey(''); setModels(null); setListed(false); setStatus({ kind: 'idle', text: '' }); }} className="text-[var(--text-muted)] hover:text-[var(--alert-red)]">Forget</button>}
          </div>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">Scripted answers for trying the pipeline on a development server. No key, no cost, no real analysis.</p>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Overline>Model</Overline>
          <span className="ml-auto text-[8.5px] font-mono tracking-[0.12em] uppercase text-[var(--text-muted)]">
            {models ? (listed ? `${models.length} on this key` : 'Known names') : info.needsKey ? 'Recommended' : ''}
          </span>
        </div>
        <ModelPicker provider={engine.provider} models={models ?? known} value={engine.model} onChange={setModel}
          suggested={info.suggested} defaultModel={info.defaultModel} listed={listed && !!models} />
        {!models && info.needsKey && <p className="text-[10px] text-[var(--text-muted)]">Check the key to list every model it can use, grouped by family.</p>}
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

/** The forecast's four stages, as the panel will show them working. */
const STAGES = ['Research', 'World', 'Panel', 'Debate', 'Report'] as const;

/* ───────────── Your data ───────────── */

interface DataFile { id: number; name: string; text: string }

/** Text a forecast can read. A PDF or Word file has to be saved as text first. */
const TEXT_TYPES = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'log', 'xml', 'html', 'htm', 'yaml', 'yml'];
const MAX_FILES = 8;
const MAX_FILE_BYTES = 2_000_000;

const fmtCount = (n: number) => (n < 1_000 ? `${n}` : n < 1_000_000 ? `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k` : `${(n / 1_000_000).toFixed(1)}M`);

/** What a forecast reads: each file under its name, then anything pasted. */
function assemble(files: DataFile[], paste: string): string {
  const parts = files.map(f => `### ${f.name}\n${f.text}`);
  if (paste.trim()) parts.push(files.length ? `### Notes\n${paste.trim()}` : paste.trim());
  return parts.join('\n\n');
}

/** A file's text, or why it cannot be read. A web page is read as its visible text, which costs far fewer tokens. */
async function readText(file: File): Promise<{ text: string } | { error: string }> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!TEXT_TYPES.includes(ext)) return { error: `${file.name}: text files only (${TEXT_TYPES.slice(0, 7).join(', ')} …). Save a PDF or Word file as text first.` };
  if (file.size > MAX_FILE_BYTES) return { error: `${file.name} is over 2 MB.` };
  let text = await file.text().catch(() => '');
  if (text.includes(String.fromCharCode(0))) return { error: `${file.name} is not a text file.` };
  if (ext === 'html' || ext === 'htm') {
    // Parsed, never run: scripts and styles are dropped, the visible text kept.
    const doc = new DOMParser().parseFromString(text, 'text/html');
    doc.querySelectorAll('script, style, noscript, template').forEach(n => n.remove());
    text = doc.body?.textContent ?? '';
  }
  text = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return text ? { text } : { error: `${file.name} is empty.` };
}

function YourData({ files, setFiles, paste, setPaste, scope, setScope, depth, providerName }: {
  files: DataFile[]; setFiles: (f: DataFile[]) => void;
  paste: string; setPaste: (v: string) => void;
  scope: SeedScope; setScope: (s: SeedScope) => void;
  depth: Depth; providerName: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const [note, setNote] = useState('');
  const [over, setOver] = useState(false);
  const chars = assemble(files, paste).length;
  const cost = seedCost(chars, depth, scope);

  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    const room = MAX_FILES - files.length;
    const picked = Array.from(list).slice(0, Math.max(0, room));
    const read = await Promise.all(picked.map(readText));
    const added: DataFile[] = [];
    const problems: string[] = list.length > room ? [`Up to ${MAX_FILES} files.`] : [];
    read.forEach((r, i) => {
      if ('error' in r) problems.push(r.error);
      else added.push({ id: nextId.current++, name: picked[i].name, text: r.text });
    });
    setFiles([...files, ...added]);
    setNote(problems.join(' '));
    if (input.current) input.current.value = '';
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border p-3" style={{ borderColor: chars ? gold(0.35) : 'var(--border-secondary)', background: chars ? gold(0.03) : 'rgba(255,255,255,0.012)' }}>
      <div
        onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); void add(e.dataTransfer.files); }}
        className="flex items-center gap-2.5 rounded-md border border-dashed px-3 py-2.5 transition-colors"
        style={{ borderColor: over ? T.gold : 'var(--border-primary)', background: over ? gold(0.08) : undefined }}>
        <Upload className="w-3.5 h-3.5 flex-shrink-0" style={{ color: over ? T.goldLight : T.mute }} />
        <span className="flex-1 min-w-0 text-[10.5px] leading-snug text-[var(--text-secondary)]">
          <button type="button" onClick={() => input.current?.click()} className="text-[var(--gold-light)] underline decoration-dotted underline-offset-2 hover:text-[var(--text-primary)]">Add files</button>
          {' '}or drop them here
          <span className="block text-[9.5px] text-[var(--text-muted)]">CSV, JSON, Markdown, text, logs, web pages</span>
        </span>
        <input ref={input} type="file" multiple hidden accept={TEXT_TYPES.map(t => `.${t}`).join(',')} onChange={e => void add(e.target.files)} aria-label="Add data files" />
      </div>

      {files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map(f => (
            <li key={f.id} className="flex items-center gap-2 h-7 pl-2 pr-1 rounded-md border border-[var(--border-secondary)] bg-black/30">
              <FileText className="w-3 h-3 flex-shrink-0 text-[var(--text-muted)]" />
              <span className="flex-1 min-w-0 truncate text-[11px] text-[var(--text-primary)]" title={f.name}>{f.name}</span>
              <span className="text-[9.5px] font-mono tabular-nums text-[var(--text-muted)]">{fmtCount(f.text.length)} chars</span>
              <button type="button" onClick={() => setFiles(files.filter(x => x.id !== f.id))} aria-label={`Remove ${f.name}`}
                className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--alert-red)] hover:bg-[var(--hover-accent)]">
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <textarea value={paste} onChange={e => setPaste(e.target.value.slice(0, SEED_MAX))} rows={3} aria-label="Paste your data"
        placeholder={files.length ? 'Notes to go with the files (optional)' : 'Or paste a report, notes, a table…'}
        className={`${FIELD} rounded-md resize-y px-2.5 py-2 text-[11px] leading-relaxed`} />

      {note && <p role="alert" className="text-[10px] leading-snug" style={{ color: T.orange }}>{note}</p>}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Overline>Who reads it</Overline>
        </div>
        <Segmented id="seed-scope" size="sm" value={scope} onChange={setScope} options={[
          { value: 'brief', label: 'World model', title: 'Read once, built into the brief every forecaster sees' },
          { value: 'panel', label: 'Whole panel', title: 'Every forecaster and the report read it directly too' },
        ]} />
        <p className="text-[10px] leading-snug text-[var(--text-muted)]">
          {scope === 'brief'
            ? 'The world model reads all of it once and builds it into the brief every forecaster sees.'
            : `As well, every forecaster in every round and the report agent read the first ${PANEL_SEED_MAX.toLocaleString()} characters directly, and can cite it.`}
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-md px-2.5 py-2" style={{ background: chars ? gold(0.07) : 'rgba(0,0,0,0.25)' }}>
        <Database className="w-3.5 h-3.5 flex-shrink-0" style={{ color: chars ? T.goldLight : T.mute }} />
        <span className="flex-1 min-w-0 text-[10.5px] leading-snug" style={{ color: chars ? T.text : T.mute }}>
          {chars
            ? <>About <span className="font-mono tabular-nums" style={{ color: T.goldLight }}>+{fmtCount(cost.tokens)}</span> input tokens on your {shortName(providerName)} key, over {cost.calls} call{cost.calls === 1 ? '' : 's'}</>
            : 'Your data is billed to your own key, as input tokens: about one per four characters.'}
        </span>
      </div>
      {chars > SEED_MAX && <p className="text-[10px] leading-snug" style={{ color: T.orange }}>That is {fmtCount(chars)} characters; a forecast reads the first {SEED_MAX.toLocaleString()}.</p>}
    </div>
  );
}

export function AskForm({ ready, providerName, onRun, onKey }: { ready: boolean; providerName: string; onKey: () => void; onRun: (input: { question: string; seed: string; seedScope: SeedScope; depth: Depth; useFeeds: boolean }) => Promise<boolean> }) {
  const [question, setQuestion] = useState('');
  const [files, setFiles] = useState<DataFile[]>([]);
  const [paste, setPaste] = useState('');
  const [scope, setScope] = useState<SeedScope>('brief');
  const [showData, setShowData] = useState(false);
  const [depth, setDepth] = useState<Depth>('standard');
  const [useFeeds, setUseFeeds] = useState(true);
  const [starting, setStarting] = useState(false);
  const valid = question.trim().length >= 8;
  const seed = assemble(files, paste);
  const dataCost = seedCost(seed.length, depth, scope);
  const run = async () => {
    if (!ready || !valid || starting) return;
    setStarting(true);
    const ok = await onRun({ question: question.trim(), seed: seed.slice(0, SEED_MAX), seedScope: scope, depth, useFeeds });
    setStarting(false);
    if (ok) { setQuestion(''); setFiles([]); setPaste(''); }
  };
  const d = DEPTHS[depth];
  // The stages that read the asker's data: the world model, and with the whole panel reading it, the debate and the report.
  const reads = (i: number) => seed.length > 0 && (i === 1 || (scope === 'panel' && i >= 3));
  return (
    <section className="px-4 pt-4 pb-4 flex flex-col gap-4">
      <div>
        <Overline color={T.goldLight}>OI Forecast</Overline>
        <h3 className="mt-1 text-[13px] font-semibold tracking-wide text-[var(--text-heading)]">Ask the panel</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
          A simulated panel of forecasters debates your question in rounds, grounded in live OSIRIS intelligence and any data you add, while the analysis draws itself on the globe.
        </p>
        <ol className="mt-2.5 grid grid-cols-[1.25fr_1fr_1fr_1fr_1fr] gap-1" aria-label="How a forecast runs">
          {STAGES.map((label, i) => (
            <li key={label} className="relative flex items-center gap-1.5 h-7 px-1.5 rounded-md border border-[var(--border-secondary)] bg-white/[0.015]" title={reads(i) ? `${label} · reads your data` : label}>
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8.5px] font-mono flex-shrink-0" style={{ color: T.goldLight, background: gold(0.12) }}>{i + 1}</span>
              <span className="text-[9.5px] leading-none truncate text-[var(--text-secondary)]">{label}</span>
              {reads(i) && <Database className="absolute -top-1 -right-1 w-3 h-3 p-[1px] rounded-sm" style={{ color: T.goldLight, background: 'var(--bg-panel-solid)' }} aria-label="reads your data" />}
            </li>
          ))}
        </ol>
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
      </div>

      <div className="flex flex-col gap-2">
        <button onClick={() => setShowData(!showData)} aria-expanded={showData}
          className="flex items-center gap-2 h-8 px-3 rounded-md border transition-colors hover:bg-[var(--hover-accent)]"
          style={{ borderColor: seed ? gold(0.35) : 'var(--border-secondary)', background: seed ? gold(0.04) : 'rgba(255,255,255,0.015)' }}>
          <Database className="w-3.5 h-3.5 flex-shrink-0" style={{ color: seed ? T.goldLight : T.mute }} />
          <span className="text-[11px] text-[var(--text-primary)]">Your data</span>
          <span className="flex-1 min-w-0 text-right text-[9.5px] font-mono tabular-nums truncate text-[var(--text-muted)]">
            {seed
              ? `${files.length ? `${files.length} file${files.length === 1 ? '' : 's'} · ` : ''}${fmtCount(Math.min(seed.length, SEED_MAX))} chars · +${fmtCount(dataCost.tokens)} tokens`
              : 'Optional · extra tokens'}
          </span>
          <ChevronDown className="w-3 h-3 flex-shrink-0 text-[var(--text-muted)] transition-transform" style={{ transform: showData ? 'rotate(180deg)' : undefined }} />
        </button>
        <AnimatePresence initial={false}>
          {showData && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
              <YourData files={files} setFiles={setFiles} paste={paste} setPaste={setPaste} scope={scope} setScope={setScope} depth={depth} providerName={providerName} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Overline>Depth</Overline>
          <span className="text-[9px] font-mono tracking-[0.1em] text-[var(--text-muted)]">{d.agents} FORECASTERS · {d.rounds} ROUNDS · ~{estimateCalls(depth, useFeeds)} CALLS</span>
        </div>
        <Segmented id="depth" value={depth} onChange={setDepth} options={(Object.keys(DEPTHS) as Depth[]).map(k => ({ value: k, label: DEPTHS[k].label }))} />
      </div>

      <div className="flex items-center gap-3 rounded-md border border-[var(--border-secondary)] bg-white/[0.015] px-3 py-2">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[var(--text-primary)]">Research and live intelligence</p>
          <p className="text-[10px] leading-snug text-[var(--text-muted)]">Search the news and background for the question, with links, plus OSIRIS news, quakes and markets</p>
        </div>
        <Switch on={useFeeds} onChange={setUseFeeds} label="Research the question and read the live OSIRIS feeds" />
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
