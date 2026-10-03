/**
 * OSIRIS OI: the research plan, what a forecast searches the web for.
 *
 * The model plans it from the question; when its plan is missing or unusable,
 * the question's own names and longest words make one. Pure and client-safe:
 * the scripted demo model plans with it too.
 */
import { terms } from './words';
import { text } from './parse';

/** What to search for: news coverage of the question, and the background behind it. */
export interface ResearchPlan {
  news: string[];
  background: string[];
}

/** A search as GDELT takes it: words of three letters or more, at most five, no operators. */
export function searchWords(q: string): string {
  return q.normalize('NFKC').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/)
    .filter(w => w.replace(/['-]/g, '').length >= 3 && !/^(or|and|not)$/i.test(w))
    .slice(0, 5).join(' ');
}

/** A plan from the question alone, when the model's is missing: its names first, then its longest words. */
const NOT_NAMES = new Set(`Will Which What Who Where When How Why Does Do Did Is Are Was Can Could Would Should Shall May Might By Before
  After In On At Of The A An If Or And Than January February March April June July August September October November December
  Monday Tuesday Wednesday Thursday Friday Saturday Sunday`.split(/\s+/));

export function planFallback(question: string): ResearchPlan {
  // Runs of capitalised words, less the question words and dates that start or fill them.
  const names = [...question.matchAll(/[A-Z][\p{L}+.&-]*(?:\s+[A-Z][\p{L}+.&-]*)*/gu)]
    .map(m => m[0].split(/\s+/).filter(w => !NOT_NAMES.has(w)).join(' ').replace(/[+.]+$/, ''))
    .filter(n => n.length >= 2);
  const words = terms(question).filter(t => !names.some(n => n.toLowerCase().includes(t))).sort((a, b) => b.length - a.length);
  const news = searchWords([...names, ...words].slice(0, 4).join(' '));
  return { news: news ? [news] : [], background: names.slice(0, 2) };
}

/** The model's plan, cleaned: up to two news searches and two background topics, else the question's own words. */
export function parsePlan(raw: Record<string, unknown> | null, question: string): ResearchPlan {
  const take = (v: unknown, n: number) => (Array.isArray(v) ? v : []).map(x => text(x, 80)).filter(Boolean).slice(0, n);
  const news = take(raw?.news ?? raw?.searches, 2).map(searchWords).filter(q => q.length >= 3);
  const background = take(raw?.background ?? raw?.topics, 2);
  const fallback = planFallback(question);
  return { news: news.length ? news : fallback.news, background: background.length ? background : fallback.background };
}
