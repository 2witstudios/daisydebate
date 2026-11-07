import { createAppError } from '@daisy/errors';
import { z } from 'zod';
import { requireProviderNotCancelled } from './cancellation';
const MAX_BYTES = 1024 * 1024;
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const amount = z.number().finite().nonnegative();
const usage = z
  .object({
    seconds: amount.optional(),
    total_tokens: count.optional(),
    input_tokens: count.optional(),
    output_tokens: count.optional(),
    cost: amount.optional(),
  })
  .refine((value) => Object.keys(value).length > 0)
  .transform((value) => ({
    ...(value.seconds === undefined ? {} : { seconds: value.seconds }),
    ...(value.total_tokens === undefined
      ? {}
      : { totalTokens: value.total_tokens }),
    ...(value.input_tokens === undefined
      ? {}
      : { inputTokens: value.input_tokens }),
    ...(value.output_tokens === undefined
      ? {}
      : { outputTokens: value.output_tokens }),
    ...(value.cost === undefined ? {} : { costUsd: value.cost }),
  }));
const schema = z.object({
  text: z.string().refine((text) => Buffer.byteLength(text) <= 65536),
  usage: usage.optional(),
});
const identity = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[\x21-\x7e]+$/)
  .optional();
const invalid = () =>
  createAppError('INFRASTRUCTURE', 'Invalid transcription response');
const allowedLength = (response: Response) => {
  const declared = response.headers.get('content-length');
  return (
    declared === null ||
    (/^\d+$/.test(declared) && Number(declared) <= MAX_BYTES)
  );
};
async function jsonBody(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<unknown> {
  const reader = body.getReader(),
    bytes = new Uint8Array(MAX_BYTES);
  let length = 0;
  try {
    for (;;) {
      requireProviderNotCancelled(signal);
      const next = await reader.read();
      requireProviderNotCancelled(signal);
      if (next.done) break;
      if (
        !(next.value instanceof Uint8Array) ||
        next.value.byteLength > MAX_BYTES - length
      )
        throw invalid();
      bytes.set(next.value, length);
      length += next.value.byteLength;
    }
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.subarray(0, length),
      ),
    );
  } finally {
    bytes.fill(0);
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}
/** Reported usage/identity only: never completeness, quality, actual provider identity or settlement authority. */
export async function readTranscription(
  response: Response,
  signal?: AbortSignal,
) {
  try {
    if (!response.body || !allowedLength(response)) {
      await response.body?.cancel();
      throw invalid();
    }
    const parsed = schema.safeParse(await jsonBody(response.body, signal));
    const generation = identity.safeParse(
      response.headers.get('x-generation-id') ?? undefined,
    );
    if (!parsed.success || !generation.success) throw invalid();
    return {
      text: parsed.data.text.trim(),
      ...(parsed.data.usage === undefined ? {} : { usage: parsed.data.usage }),
      ...(generation.data === undefined
        ? {}
        : { generationId: generation.data }),
    };
  } catch {
    requireProviderNotCancelled(signal);
    // Raw JSON/stream/cleanup errors may contain private transcript fragments.
    throw invalid();
  }
}
