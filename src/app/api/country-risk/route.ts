import { NextResponse } from 'next/server';
import {
  buildCountryRisk,
  quakeMagnitudeByCountry,
  RISK_FACTORS,
  BASELINE_REVIEWED,
} from '@/lib/country-risk';

/**
 * OSIRIS — country risk index.
 *
 * The per-country baseline is an editorial ordering, not a calibrated model;
 * see `@/lib/country-risk`. The response labels it as such and reports the
 * observed earthquake component separately so neither is mistaken for the
 * other.
 */

// Major stock exchange status
const EXCHANGES = [
  { name: 'NYSE', tz: 'America/New_York', open: 9.5, close: 16, country: 'US' },
  { name: 'NASDAQ', tz: 'America/New_York', open: 9.5, close: 16, country: 'US' },
  { name: 'LSE', tz: 'Europe/London', open: 8, close: 16.5, country: 'GB' },
  { name: 'TSE', tz: 'Asia/Tokyo', open: 9, close: 15, country: 'JP' },
  { name: 'SSE', tz: 'Asia/Shanghai', open: 9.5, close: 15, country: 'CN' },
  { name: 'HKEX', tz: 'Asia/Hong_Kong', open: 9.5, close: 16, country: 'HK' },
  { name: 'BSE', tz: 'Asia/Kolkata', open: 9.25, close: 15.5, country: 'IN' },
  { name: 'FRA', tz: 'Europe/Berlin', open: 8, close: 20, country: 'DE' },
  { name: 'TSX', tz: 'America/Toronto', open: 9.5, close: 16, country: 'CA' },
  { name: 'ASX', tz: 'Australia/Sydney', open: 10, close: 16, country: 'AU' },
  { name: 'KRX', tz: 'Asia/Seoul', open: 9, close: 15.5, country: 'KR' },
  { name: 'MOEX', tz: 'Europe/Moscow', open: 10, close: 18.5, country: 'RU' },
];

function isExchangeOpen(ex: typeof EXCHANGES[0]): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: ex.tz, hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short',
    });
    const parts = formatter.formatToParts(now);
    const weekday = parts.find(p => p.type === 'weekday')?.value || '';
    if (['Sat', 'Sun'].includes(weekday)) return false;
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
    const decimal = hour + minute / 60;
    return decimal >= ex.open && decimal < ex.close;
  } catch { return false; }
}

export async function GET() {
  try {
    const exchangeStatus = EXCHANGES.map(ex => ({
      name: ex.name, country: ex.country, open: isExchangeOpen(ex),
    }));

    // Enrich the baseline with recent significant earthquakes.
    let quakeMagnitude: Record<string, number> = {};
    let quakesAvailable = false;
    try {
      const res = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson', { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const data = await res.json();
        quakeMagnitude = quakeMagnitudeByCountry(data.features || []);
        quakesAvailable = true;
      }
    } catch (e) { console.warn('[OSIRIS] Suppressed error:', e instanceof Error ? e.message : e); }

    return NextResponse.json({
      countries: buildCountryRisk(quakeMagnitude),
      methodology: {
        basis: 'editorial',
        summary:
          'base_risk is a hand-assigned 0-100 ordering of current disruption, not a calibrated or back-tested probability. Do not cite it as a validated figure.',
        baseline_reviewed: BASELINE_REVIEWED,
        countries_covered: Object.keys(RISK_FACTORS).length,
        observed_component: quakesAvailable
          ? 'quake_magnitude is the summed magnitude of USGS M4.5+ events in the last day.'
          : 'quake_magnitude is 0 for every country: the USGS feed did not answer, so no observed component was added.',
        quakes_available: quakesAvailable,
      },
      exchanges: exchangeStatus,
      open_exchanges: exchangeStatus.filter(e => e.open).length,
      total_exchanges: exchangeStatus.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ countries: [], exchanges: [], error: 'Failed' }, { status: 500 });
  }
}
