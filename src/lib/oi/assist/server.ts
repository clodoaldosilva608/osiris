/**
 * OSIRIS OI Assist: the server's half of a step.
 *
 * The page sends the conversation and what is on screen; this checks both,
 * puts them to the reader's model on the reader's key, and returns the step
 * the model chose. Nothing is kept: the conversation lives in the page.
 */
import { createChat, providerInfo, ProviderError, type ChatFn } from '../providers';
import type { Credentials } from '../service';
import { parseStep, sanitizeContext, sanitizeMessages, systemPrompt, userPrompt, type Step } from './protocol';

export type Stepped =
  | { ok: true; step: Step; usage: { input: number; output: number } }
  | { ok: false; status: number; error: string };

export async function assistStep(body: Record<string, unknown>, creds: Credentials, signal?: AbortSignal, chat?: ChatFn): Promise<Stepped> {
  const messages = sanitizeMessages(body.messages);
  const last = messages[messages.length - 1];
  if (!last || last.role === 'assistant') return { ok: false, status: 400, error: 'Send the conversation, ending with your message or the results of the last actions.' };
  if (!creds.provider) return { ok: false, status: 400, error: 'Choose a provider (X-OI-Provider).' };
  const info = providerInfo(creds.provider);
  if (!creds.key && info.needsKey) return { ok: false, status: 401, error: `OI Assist runs on your own ${info.name} key (X-OI-Key or Authorization: Bearer).` };
  const context = sanitizeContext(body.context);
  try {
    const call = chat ?? createChat(creds.provider, creds.key ?? '', creds.model || info.defaultModel);
    const out = await call({ system: systemPrompt(), user: userPrompt(messages, context), json: true, maxTokens: 1400, temperature: 0.3, timeoutMs: 45_000, signal });
    return { ok: true, step: parseStep(out.text), usage: { input: out.input, output: out.output } };
  } catch (err) {
    if (err instanceof ProviderError) {
      const status = err.code === 'auth' ? 401 : err.code === 'quota' ? 402 : err.code === 'rate' ? 429 : err.code === 'model' || err.code === 'bad_request' ? 400 : 502;
      return { ok: false, status, error: err.message };
    }
    if (signal?.aborted) return { ok: false, status: 499, error: 'Cancelled.' };
    return { ok: false, status: 500, error: 'OI could not answer just then.' };
  }
}
