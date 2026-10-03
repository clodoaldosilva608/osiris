import { describe, it, expect, vi, afterEach } from 'vitest';

const KP_URL = 'planetary_k_index_1m';

/** Answers the Kp request per `kp`, and always answers alerts and flares. */
function mockNoaa(kp: 'ok' | 'fail') {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes(KP_URL)) {
      if (kp === 'fail') throw new Error('NOAA unavailable');
      return { json: async () => [{ kp_index: '5.33', time_tag: '2026-09-15T21:00:00' }] };
    }
    return { json: async () => [] };
  }));
}

async function get() {
  vi.resetModules();
  const { GET } = await import('./route');
  return (await GET()).json();
}

afterEach(() => vi.unstubAllGlobals());

describe('GET /api/space-weather', () => {
  it('classifies a real Kp reading', async () => {
    mockNoaa('ok');
    const body = await get();

    expect(body.kp_index).toBeCloseTo(5.33);
    expect(body.kp_available).toBe(true);
    expect(body.storm_level).toBe('Moderate (G2)');
  });

  /* The bug: the Kp request failing while the others succeeded left the
     initial 0 in place and reported it as 'Quiet' — calm conditions asserted
     from no data. */
  it('reports unknown, not Quiet, when the Kp request fails', async () => {
    mockNoaa('fail');
    const body = await get();

    expect(body.kp_index).toBeNull();
    expect(body.kp_available).toBe(false);
    expect(body.storm_level).toBe('Unknown');
    expect(body.storm_level).not.toBe('Quiet');
  });

  it('still calls a genuinely quiet reading Quiet', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      json: async () => (String(url).includes(KP_URL) ? [{ kp_index: '1', time_tag: 't' }] : []),
    })));
    const { GET } = await import('./route');
    const body = await (await GET()).json();

    expect(body.kp_index).toBe(1);
    expect(body.storm_level).toBe('Quiet');
  });
});
