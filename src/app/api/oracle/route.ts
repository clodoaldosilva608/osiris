import { describe, disabled, disabledResponse, json, siteOrigin } from '@/lib/oracle/service';

/**
 * OSIRIS Oracle — what the service offers: providers, depths, limits, endpoints.
 * GET /api/oracle
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (disabled()) return disabledResponse();
  return json(describe(siteOrigin(req)));
}
