import { describe, it, expect, vi, afterEach } from 'vitest';

/** The exact record the audit used to reproduce the fabricated feed. */
const FIXTURE = [
  { ip_address: '192.0.2.10', country: 'US', malware: 'Emotet', dst_port: 443, status: 'offline' },
];

/**
 * The route caches for five minutes, so each call here gets a fresh module —
 * otherwise a test would assert against the previous test's cached payload.
 */
async function get(body: unknown) {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })));
  const { GET } = await import('./route');
  return (await GET()).json();
}

afterEach(() => vi.unstubAllGlobals());

describe('GET /api/cyber-attacks', () => {
  it('reports one indicator for one record, with no invented attack', async () => {
    const body = await get(FIXTURE);

    expect(body.total).toBe(1);
    expect(body.indicators).toHaveLength(1);
    expect(body.online).toBe(0); // the fixture's C2 is offline
    expect(body.indicators[0]).toMatchObject({
      id: '192.0.2.10:443', ip: '192.0.2.10', port: 443, malware: 'Emotet',
      status: 'offline', country: 'US', location_precision: 'country',
    });
    expect(JSON.stringify(body)).not.toMatch(/EXFILTRATION|CREDENTIAL HARVEST|LATERAL MOVE|src_lat/);
    expect(body.source).toBe('abuse.ch Feodo Tracker');
  });

  it("separates fetch time from the record's observation times", async () => {
    const body = await get([{ ...FIXTURE[0], first_seen: '2026-02-01 09:00:00', last_online: '2026-02-08' }]);

    expect(body.fetched_at).toEqual(expect.any(String));
    expect(body.indicators[0].first_seen).toBe('2026-02-01 09:00:00');
    expect(body.indicators[0].last_online).toBe('2026-02-08');
    expect(body.indicators[0]).not.toHaveProperty('fetched_at');
  });

  it('holds its intelligence fields steady across repeated fetches', async () => {
    const first = await get(FIXTURE);
    const second = await get(FIXTURE);

    expect(second.indicators).toEqual(first.indicators);
    expect(second.total).toBe(first.total);
  });

  it('counts a C2 listed twice once', async () => {
    const body = await get([FIXTURE[0], { ...FIXTURE[0] }]);
    expect(body.total).toBe(1);
  });

  it('returns an empty feed rather than filler when the provider fails', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => [] })));
    const { GET } = await import('./route');
    const body = await (await GET()).json();

    expect(body).toMatchObject({ indicators: [], total: 0, online: 0 });
  });
});
