import { createAppError } from '@daisy/errors';
import { z } from 'zod';
import { requireProviderNotCancelled } from './cancellation';
import { finishOf, type CompletionFinish } from './completion-finish';
import { sseData } from './sse';

/** One chunk of a streamed completion; the last one carries the usage. */
const chunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullable().optional(),
            refusal: z.string().nullable().optional(),
          })
          .optional(),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .optional(),
  usage: z
    .object({ prompt_tokens: z.number(), completion_tokens: z.number() })
    .nullable()
    .optional(),
  /** A failure after the stream opened arrives as a chunk, never a status. */
  error: z.unknown().optional(),
});
type Chunk = z.infer<typeof chunkSchema>;

const broken = (how: string) =>
  createAppError('INFRASTRUCTURE', `OpenRouter completion stream ${how}`);

/** One event's chunk; anything that is not one, or reports an error, breaks the stream. */
function chunkOf(data: string): Chunk {
  const parsed = chunkSchema.safeParse(JSON.parse(data));
  if (!parsed.success) throw broken('answered an unexpected shape');
  if (parsed.data.error !== undefined) throw broken('failed');
  return parsed.data;
}

/**
 * Reads a streamed completion to its end marker, handing each piece of text
 * to `onText` as it arrives. A stream that reports an error, is not what was
 * asked for, or ends before its marker throws: the vendor served part of it,
 * so the caller treats that as uncertain, and the text already handed on
 * stays handed on.
 */
export async function readCompletionStream(
  body: ReadableStream<Uint8Array> | null,
  onText: (text: string) => void,
  signal?: AbortSignal,
) {
  if (!body) throw broken('had no body');
  let text = '',
    finish: CompletionFinish = 'none',
    refused = false,
    promptTokens = 0,
    completionTokens = 0;
  for await (const data of sseData(body)) {
    requireProviderNotCancelled(signal);
    if (data === '[DONE]')
      return { text, finish, refused, promptTokens, completionTokens };
    const { choices, usage } = chunkOf(data);
    const choice = choices?.[0];
    if (choice?.delta?.refusal) refused = true;
    if (choice?.finish_reason) finish = finishOf(choice.finish_reason);
    promptTokens = usage?.prompt_tokens ?? promptTokens;
    completionTokens = usage?.completion_tokens ?? completionTokens;
    const piece = choice?.delta?.content;
    if (piece) {
      text += piece;
      onText(piece);
    }
  }
  throw broken('ended early');
}
