import { getClientIp } from '@/lib/ssrf-guard';
import { cancelRun, getRun, ownsRun, runSummary, waitForEnd, waitSlot } from '@/lib/oai/runs';
import { disabled, disabledResponse, fail, json, siteOrigin } from '@/lib/oai/service';

/**
 * OSIRIS OAI — one run.
 *
 * GET    /api/oai/runs/{id}            the summary
 * GET    /api/oai/runs/{id}?wait=30    waits up to 55 s for the run to finish first
 * GET    /api/oai/runs/{id}?view=full  every event so far, to rebuild the whole run
 * DELETE /api/oai/runs/{id}            cancel; needs X-OAI-Run-Token
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (disabled()) return disabledResponse();
  const run = getRun((await params).id);
  if (!run) return fail(404, 'No such run. Runs are kept for a few hours.');

  const url = new URL(req.url);
  const wait = Math.min(55, Math.max(0, Number(url.searchParams.get('wait')) || 0));
  // A wait past this address's share of held connections answers at once instead.
  const release = wait ? waitSlot(getClientIp(req)) : null;
  if (release) {
    try { await waitForEnd(run, wait * 1000, req.signal); } finally { release(); }
  }

  if (url.searchParams.get('view') === 'full') {
    return json({ id: run.id, status: run.state.status, events: run.events });
  }
  return json(runSummary(run, siteOrigin(req)));
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (disabled()) return disabledResponse();
  const run = getRun((await params).id);
  if (!run) return fail(404, 'No such run.');
  if (!ownsRun(run, req.headers.get('x-oai-run-token'))) return fail(403, 'Only whoever started the run can cancel it (X-OAI-Run-Token).');
  const cancelled = cancelRun(run);
  return json({ id: run.id, cancelled, status: cancelled ? 'cancelling' : run.state.status });
}
