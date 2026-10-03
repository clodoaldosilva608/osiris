import { describe, it, expect } from 'vitest';
import { DATA_ID, dataExcerpts, parseCites, quoteIn, sourceIds, sourceTexts, wholeData } from './sources';
import type { ContextItem } from './types';

const NEWS: ContextItem = { id: 'c1', kind: 'news', title: 'Envoys due in Geneva for “final round” of talks', source: 'Wire', published: '', place: 'Geneva', lat: 46.2, lng: 6.14 };

describe('quoteIn', () => {
  it('finds the words whatever the case, punctuation or quote marks', () => {
    expect(quoteIn('envoys due in Geneva for "final round"', NEWS.title)).toBe(true);
    expect(quoteIn('Envoys due in Geneva … talks', NEWS.title)).toBe(true);
  });

  it('refuses words that are not there, in another order, or too few to mean anything', () => {
    expect(quoteIn('Envoys arrive in Geneva', NEWS.title)).toBe(false);
    expect(quoteIn('talks … Envoys due', NEWS.title)).toBe(false);
    expect(quoteIn('in', NEWS.title)).toBe(false);
    // Whole words only: "round of" is there, "roun" is not.
    expect(quoteIn('final roun', NEWS.title)).toBe(false);
  });
});

describe('dataExcerpts', () => {
  const seed = '### channel-checks.csv\ndate,region,ready\n2026-09-01,Geneva,7 of 9 delegations ready\n\n### Notes\nThe hosts expect a signing in November.';

  it('keeps passages really in the data, under the file they came from, in the model\'s own numbering', () => {
    const out = dataExcerpts([
      { text: '2026-09-01,Geneva,7 of 9 delegations ready' },
      { text: 'All delegations have signed already.' },
      'The hosts expect a signing in November.',
    ], seed);
    expect(out.map(d => [d.id, d.source])).toEqual([['d1', 'channel-checks.csv'], ['d3', 'Your notes']]);
    expect(out[0]).toMatchObject({ kind: 'data', lat: null, lng: null });
  });

  it('names pasted data without files as the asker\'s, and offers nothing without data', () => {
    expect(dataExcerpts([{ text: 'a signing in November is expected' }], 'We hear a signing in November is expected.')[0].source).toBe('Your data');
    expect(dataExcerpts([{ text: 'anything at all here' }], '  ')).toEqual([]);
    expect(wholeData(seed)).toMatchObject({ id: DATA_ID, source: 'channel-checks.csv' });
  });
});

describe('parseCites', () => {
  const texts = sourceTexts([NEWS, { ...NEWS, id: 'd1', kind: 'data', title: '7 of 9 delegations ready', source: 'checks.csv' }]);

  it('keeps quotes of known sources, one per source, and marks which are word for word', () => {
    const cites = parseCites([
      { source: 'c1', quote: '“Envoys due in Geneva”' },
      { source: '[D1]', quote: 'seven of nine delegations are ready' },
      { source: 'c1', quote: 'a second quote from the same item' },
      { source: 'c9', quote: 'an item that does not exist' },
      { source: 'd1', quote: '' },
    ], texts);
    expect(cites).toEqual([
      { source: 'c1', quote: 'Envoys due in Geneva', exact: true },
      { source: 'd1', quote: 'seven of nine delegations are ready', exact: false },
    ]);
  });

  it('checks a news quote against the outlet too, and caps the list', () => {
    expect(parseCites([{ source: 'c1', quote: 'talks Wire' }], texts)[0].exact).toBe(true);
    expect(parseCites('not a list', texts)).toEqual([]);
    expect(sourceIds(['c1', 'C1', 'zz', 'd1'], new Set(texts.keys()))).toEqual(['c1', 'd1']);
  });
});
