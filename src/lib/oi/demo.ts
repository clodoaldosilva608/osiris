/**
 * A scripted model for the tests and for local development: it answers every
 * stage of a run with plausible JSON, so the whole pipeline (engine, API,
 * MCP, panel and globe) can be exercised without anyone's key or money.
 *
 * It is offered as a provider only outside production (see providers.ts).
 */
import type { ChatFn, ChatRequest } from './providers';
import { demoAssist } from './assist/demo';
import { ASSIST_SYSTEM_START } from './assist/protocol';

const ACTORS = [
  { id: 'usa', name: 'United States', kind: 'state', country: 'US', place: 'Washington', lat: 38.9, lng: -77.04, lean: 0.3 },
  { id: 'china', name: 'China', kind: 'state', country: 'CN', place: 'Beijing', lat: 39.9, lng: 116.4, lean: -0.4 },
  { id: 'eu', name: 'European Union', kind: 'organisation', country: 'BE', place: 'Brussels', lat: 50.85, lng: 4.35, lean: 0.2 },
  { id: 'russia', name: 'Russia', kind: 'state', country: 'RU', place: 'Moscow', lat: 55.75, lng: 37.62, lean: -0.5 },
  { id: 'opec', name: 'OPEC+', kind: 'organisation', country: 'AT', place: 'Vienna', lat: 48.21, lng: 16.37, lean: -0.1 },
  { id: 'india', name: 'India', kind: 'state', country: 'IN', place: 'New Delhi', lat: 28.61, lng: 77.21, lean: 0.1 },
  { id: 'gulf', name: 'Gulf states', kind: 'group', country: 'SA', place: 'Riyadh', lat: 24.71, lng: 46.68, lean: 0 },
  { id: 'markets', name: 'Global bond markets', kind: 'market', country: 'GB', place: 'London', lat: 51.51, lng: -0.13, lean: 0.2 },
  { id: 'brazil', name: 'Brazil', kind: 'state', country: 'BR', place: 'Brasília', lat: -15.79, lng: -47.88, lean: 0.1 },
  { id: 'japan', name: 'Japan', kind: 'state', country: 'JP', place: 'Tokyo', lat: 35.68, lng: 139.69, lean: 0.3 },
];

const RELATIONS: [string, string, string, number][] = [
  ['usa', 'china', 'rivalry', 0.9], ['usa', 'eu', 'alliance', 0.8], ['usa', 'japan', 'alliance', 0.8], ['russia', 'china', 'alliance', 0.6],
  ['eu', 'russia', 'sanctions', 0.7], ['opec', 'gulf', 'alliance', 0.9], ['opec', 'russia', 'negotiation', 0.6], ['india', 'russia', 'trade', 0.5],
  ['markets', 'usa', 'influence', 0.7], ['brazil', 'china', 'trade', 0.6], ['japan', 'china', 'rivalry', 0.5], ['india', 'usa', 'negotiation', 0.4],
];

const PEOPLE = [
  ['Mara Ellison', 'Sovereign risk analyst', 'New York, United States', 40.71, -74.01],
  ['Kenji Arakawa', 'Energy desk trader', 'Tokyo, Japan', 35.68, 139.69],
  ['Lucía Ferreyra', 'Political economist', 'Buenos Aires, Argentina', -34.6, -58.38],
  ['Tomasz Wrona', 'Security analyst', 'Warsaw, Poland', 52.23, 21.01],
  ['Amara Okafor', 'Commodities strategist', 'Lagos, Nigeria', 6.52, 3.38],
  ['Farid Haddad', 'Former diplomat', 'Beirut, Lebanon', 33.89, 35.5],
  ['Priya Raman', 'Superforecaster', 'Bengaluru, India', 12.97, 77.59],
  ['Henrik Lund', 'Historian of crises', 'Oslo, Norway', 59.91, 10.75],
  ['Wei Lin', 'Trade policy researcher', 'Singapore', 1.35, 103.82],
  ['Sofia Marchetti', 'Central bank watcher', 'Frankfurt, Germany', 50.11, 8.68],
  ['Diego Salas', 'Shipping analyst', 'Panama City, Panama', 8.98, -79.52],
  ['Nadia Petrova', 'Contrarian macro investor', 'Dubai, UAE', 25.2, 55.27],
  ['Joon-ho Park', 'Defence journalist', 'Seoul, South Korea', 37.57, 126.98],
  ['Grace Mwangi', 'Development economist', 'Nairobi, Kenya', -1.29, 36.82],
  ['Liam Byrne', 'Sell-side strategist', 'London, United Kingdom', 51.51, -0.13],
  ['Ana Costa', 'Climate risk modeller', 'São Paulo, Brazil', -23.55, -46.63],
] as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** The kind of question, judged the way a model would: from how it is asked. */
function kindOf(question: string): 'binary' | 'choice' | 'number' {
  if (/^\s*(how (much|many|high|low|far)|what (price|level|share|rate|percentage|will .* (cost|be worth|trade at|reach))|at what)/i.test(question)) return 'number';
  if (/^\s*(who|which)\b/i.test(question)) return 'choice';
  return 'binary';
}

const DEMO_OUTCOMES = ['Front-runner', 'Challenger', 'Outsider', 'Other'];

/** A figure from a prompt line such as "ANCHOR: 86.4 USD per barrel". */
const figure = (u: string, label: string) => {
  const m = u.match(new RegExp(`^${label}: ([-0-9.,]+)`, 'm'));
  return m ? parseFloat(m[1].replace(/,/g, '')) : null;
};

/** The first words of a text, cut at a word, as a quote copied from it. */
const opening = (t: string, words = 9) => t.split(/\s+/).slice(0, words).join(' ').replace(/[,;:]$/, '');

/** The sources a prompt lists, by id, with the words each says. */
function feedSources(u: string): { id: string; says: string }[] {
  return [...u.matchAll(/^\[([cd]\d+)\] (.*)$/gm)].map(m => {
    const rest = m[2];
    const quoted = /— "(.*)"$/.exec(rest);
    return { id: m[1], says: quoted ? quoted[1] : rest.split(' — ').slice(1).join(' — ') };
  }).filter(x => x.says.trim());
}

function answer(req: ChatRequest): string {
  // OI Assist has its own script: the conversation, not the forecast pipeline.
  if (req.system.startsWith(ASSIST_SYSTEM_START)) return demoAssist(req.user);
  const u = req.user;
  if (u.includes('Build the world model')) {
    const cites = [...u.matchAll(/^\[(c\d+)\]/gm)].map(m => m[1]).slice(0, 5);
    const question = (u.match(/QUESTION: (.*)/)?.[1] ?? 'The event happens').trim();
    // Passages of the asker's data, copied as they are: its longer lines, headings left out.
    const seed = /SEED \(material[^\n]*\n<<<\n([\s\S]*?)\n>>>/.exec(u)?.[1] ?? '';
    const passages = seed === '(none)' ? [] : seed.split('\n').map(l => l.trim()).filter(l => l.length >= 20 && !l.startsWith('###')).slice(0, 3).map(l => opening(l, 24));
    const kind = kindOf(question);
    return JSON.stringify({
      kind,
      ...(kind === 'choice' ? { outcomes: DEMO_OUTCOMES, prior: [0.4, 0.3, 0.2, 0.1] } : {}),
      ...(kind === 'number' ? { unit: 'USD per barrel', anchor: 84.2 } : {}),
      proposition: question,
      resolution: 'Resolves YES if credible reporting confirms it by the horizon.',
      horizon: '2026-12-31',
      base_rate: 0.3,
      base_rate_reason: 'Comparable episodes resolved this way about three times in ten.',
      focus: { place: 'Geneva', lat: 46.2, lng: 6.14 },
      actors: ACTORS.map(a => ({ ...a, role: `${a.name} sets the pace on this question.` })),
      relations: RELATIONS.map(([from, to, kind, strength]) => ({ from, to, kind, strength, note: `${from} and ${to}: ${kind}` })),
      evidence: [...cites, ...passages.map((_, i) => `d${i + 1}`)].map((c, i) => ({ source: c, actor: ACTORS[i % ACTORS.length].id, effect: i % 2 ? 'no' : 'yes', note: 'Bears on the outcome.' })),
      ...(passages.length ? { quotes: passages.map(text => ({ text, note: 'From your data.' })) } : {}),
    });
  }
  if (u.includes('Assemble a panel of')) {
    const n = Number(u.match(/panel of (\d+)/)?.[1] ?? 8);
    return JSON.stringify({
      agents: PEOPLE.slice(0, n).map(([name, role, place, lat, lng], i) => ({
        id: slug(name), name, role, place, lat, lng,
        lens: 'Weighs incentives over rhetoric.', bias: 'Anchoring on the last crisis.',
        watches: [ACTORS[i % ACTORS.length].id, ACTORS[(i + 3) % ACTORS.length].id], prior: 0.2 + 0.5 * hash(name),
      })),
    });
  }
  if (u.includes('This is round')) {
    const name = u.match(/You are ([^,]+),/)?.[1] ?? 'Someone';
    const round = Number(u.match(/This is round (\d+) of/)?.[1] ?? 1);
    const others = [...u.matchAll(/^- ([a-z0-9_]+) · /gm)].map(m => m[1]).filter(id => id !== slug(name));
    const start = 0.15 + 0.6 * hash(name);
    const p = start + (0.42 - start) * (1 - 1 / (1 + round));
    const breaking = u.includes('BREAKING') ? 0.08 : 0;
    const target = others[Math.floor(hash(name + round) * others.length)];
    const kind = /^KIND: (\w+)/m.exec(u)?.[1] ?? 'binary';
    // Quote a source or two, word for word, when there is one to quote.
    const sources = u.includes('"cites"') ? feedSources(u) : [];
    const pick = (k: number) => sources[Math.floor(hash(name + round + k) * sources.length)];
    const cites = [...new Set([pick(0), pick(1)].filter(Boolean))].map(src => ({ source: src.id, quote: opening(src.says) }));
    const shape: Record<string, unknown> = {};
    if (kind === 'choice') {
      const n = (u.match(/^OUTCOMES: (.*)$/m)?.[1].match(/\d+\./g) ?? []).length || 4;
      // Leanings that start apart and drift toward the front-runner, round by round.
      const raw = Array.from({ length: n }, (_, k) => (k === 0 ? 0.35 + 0.1 * round : 0.2 + 0.4 * hash(name + k)) + breaking * (k === 1 ? 2 : 0));
      const total = raw.reduce((t, v) => t + v, 0);
      shape.shares = raw.map(v => Math.round((v / total) * 100) / 100);
    } else if (kind === 'number') {
      const anchor = figure(u, 'ANCHOR') ?? 80;
      const value = anchor * (0.92 + 0.2 * hash(name)) * (1 - 0.02 * (round - 1)) * (1 + breaking);
      shape.estimate = Math.round(value * 10) / 10;
      shape.low = Math.round(value * 0.9 * 10) / 10;
      shape.high = Math.round(value * 1.12 * 10) / 10;
    } else {
      shape.probability = Math.round(Math.min(0.95, p + breaking) * 100) / 100;
    }
    return JSON.stringify({
      ...shape,
      confidence: 0.4 + 0.5 * hash(name + 'c'),
      post: round === 1
        ? `Opening view from ${name.split(' ')[0]}: the base rate is the anchor, and nothing in the feed moves me far off it yet.`
        : `Round ${round}: ${target ? `${target.replace(/_/g, ' ')} makes a fair point, ` : ''}but the incentives still cut the other way.`,
      reasoning: 'Base rate first, then the strongest actor incentives.',
      ...(cites.length ? { cites } : {}),
      replies: target ? [{ to: target, stance: hash(target + round) > 0.5 ? 'agree' : 'disagree', point: 'Your timeline looks too tight.' }] : [],
      focus: [ACTORS[Math.floor(hash(name + round) * ACTORS.length)].id],
      changed: round === 1 ? 'nothing' : 'The panel’s spread narrowed.',
    });
  }
  if (u.includes('report agent') && u.includes('JSON shape')) {
    const swarm = Number(u.match(/consensus is (\d+)%/)?.[1] ?? 40) / 100;
    const kind = /^KIND: (\w+)/m.exec(u)?.[1] ?? 'binary';
    const median = parseFloat(u.match(/median is ([-0-9.,]+)/)?.[1]?.replace(/,/g, '') ?? '');
    const ids = feedSources(u).map(x => x.id);
    const sourced = (k: number) => (ids.length ? { sources: [ids[k % ids.length], ids[(k + 2) % ids.length]].filter((v, i, a) => a.indexOf(v) === i) } : {});
    const answerFields = kind === 'choice'
      ? { shares: [0.46, 0.29, 0.17, 0.08] }
      : kind === 'number' && Number.isFinite(median)
        ? { estimate: { value: median, low: Math.round(median * 0.9 * 10) / 10, high: Math.round(median * 1.1 * 10) / 10 } }
        : { probability: swarm };
    return JSON.stringify({
      headline: kind === 'choice' ? 'The front-runner holds, the challenger is live' : kind === 'number' ? 'A narrow range, slightly below today' : 'Panel leans no, with a live minority case',
      ...answerFields,
      confidence: 'medium',
      summary: 'The panel converged below even odds. The base rate anchors the view, while the minority sees a faster path if the main actors align. The spread narrowed every round.',
      drivers: [
        { text: 'Great-power rivalry limits room for a deal', push: 'no', weight: 0.7, actor: 'china', ...sourced(0) },
        { text: 'Allied coordination is unusually tight', push: 'yes', weight: 0.5, actor: 'eu', ...sourced(1) },
        { text: 'Energy prices raise the cost of escalation', push: 'no', weight: 0.4, actor: 'opec', ...sourced(2) },
      ],
      scenarios: [
        { name: 'Muddle through', probability: 0.5, description: 'No decisive move before the horizon.', place: 'Brussels', lat: 50.85, lng: 4.35 },
        { name: 'Breakthrough', probability: swarm, description: 'A deal lands late in the window.', place: 'Geneva', lat: 46.2, lng: 6.14 },
        { name: 'Escalation', probability: 0.15, description: 'A crisis overtakes the agenda.', place: 'Taipei', lat: 25.03, lng: 121.56 },
      ],
      signposts: [
        { text: 'Envoys meet in person', means: 'yes', place: 'Geneva', lat: 46.2, lng: 6.14 },
        { text: 'New export controls announced', means: 'no', place: 'Washington', lat: 38.9, lng: -77.04 },
        { text: 'Tanker traffic falls in the Strait of Hormuz', means: 'no', place: 'Strait of Hormuz', lat: 26.57, lng: 56.25 },
      ],
      dissent: 'A third of the panel sees a fast path if the summit holds.',
      caveats: ['Demo model: scripted answers, not analysis.'],
      deviation_reason: null,
    });
  }
  return 'This is the demo model talking. With a real provider, the panelist or the report agent would answer here in character.';
}

/** A chat function that answers from the script, after `delay` ms (a range, to look like a live model). */
export function createDemoChat(delay: [number, number] = [0, 0]): ChatFn {
  return async req => {
    const wait = delay[0] + Math.random() * (delay[1] - delay[0]);
    if (wait > 0) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, wait);
        req.signal?.addEventListener('abort', () => { clearTimeout(t); reject(req.signal!.reason); }, { once: true });
      });
    }
    if (req.signal?.aborted) throw req.signal.reason;
    const text = answer(req);
    return { text, input: Math.round(req.user.length / 4), output: Math.round(text.length / 4) };
  };
}
