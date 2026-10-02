import { getClientIp } from '@/lib/ssrf-guard';
import { runSummary } from '@/lib/oai/runs';
import { credentials, disabled, disabledResponse, fail, json, readBody, siteOrigin, startPrediction } from '@/lib/oai/service';

/**
 * OSIRIS OAI — start a prediction.
 *
 * POST /api/oai/runs
 *   headers  X-OAI-Provider, X-OAI-Key (or Authorization: Bearer), X-OAI-Model (optional)
 *   body     { question, seed?, depth?: quick|standard|deep, use_feeds?: boolean }
 *
 * Answers 202 at once with the run's id and token. Follow it on
 * /api/oai/runs/{id}/events (SSE), or poll /api/oai/runs/{id}?wait=30.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (disabled()) return disabledResponse();
  const body = await readBody(req, 64_000);
  if (!body) return fail(400, 'Send a JSON body of at most 64 KB: { "question": "…" }.');
  const creds = credentials(req, body);
  if ('error' in creds) return fail(400, creds.error);

  const started = startPrediction(body, creds, getClientIp(req));
  if (!started.ok) return fail(started.status, started.error);

  const origin = siteOrigin(req);
  const { run } = started;
  return json({
    ...runSummary(run, origin),
    /** Keep this: it is what lets you inject events into, or cancel, this run. It is not shown again. */
    run_token: run.token,
    events_url: `${origin}/api/oai/runs/${run.id}/events`,
  }, 202);
}
