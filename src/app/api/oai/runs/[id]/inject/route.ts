import { getRun, injectEvent, ownsRun } from '@/lib/oai/runs';
import { disabled, disabledResponse, fail, json, readBody } from '@/lib/oai/service';

/**
 * OSIRIS OAI — the god's-eye view: drop an event into a running simulation.
 * The panel takes it up at the start of its next round.
 *
 * POST /api/oai/runs/{id}/inject
 *   headers  X-OAI-Run-Token (from the start response)
 *   body     { text }
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (disabled()) return disabledResponse();
  const run = getRun((await params).id);
  if (!run) return fail(404, 'No such run.');
  if (!ownsRun(run, req.headers.get('x-oai-run-token'))) return fail(403, 'Only whoever started the run can inject events (X-OAI-Run-Token).');
  const body = await readBody(req, 4_000);
  if (!body) return fail(400, 'Send a JSON body: { "text": "…" }.');
  const done = injectEvent(run, body.text);
  if (!done.ok) return fail(done.status, done.error);
  return json({ id: run.id, queued: true, lands_in_round: Math.min(run.state.rounds.length + 1, run.state.roundsPlanned) || 1 }, 202);
}
