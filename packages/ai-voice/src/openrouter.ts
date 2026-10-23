import { createAppError, isAppError } from '@daisy/errors';
import { z } from 'zod';
import { readPcmSpeech, requireSpeechNotCancelled } from './pcm';
import { requireProviderNotCancelled } from './cancellation';

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type ChatMessage = {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
};

export type CompletionRequest = {
  readonly signal?: AbortSignal;
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly maxTokens: number;
  readonly temperature?: number;
  /** Ask the model for a JSON object (structured output). */
  readonly json?: boolean;
  /**
   * How hard the model thinks before answering; its reasoning is never
   * returned. Some models require reasoning and refuse 'none'.
   */
  readonly reasoning?: 'none' | 'low' | 'medium' | 'high';
};

const BASE = 'https://openrouter.ai/api/v1';

/**
 * Only providers that retain no prompts or outputs serve these requests
 * (OpenRouter's zero-data-retention routing): debate speech is personal data.
 */
const DATA_POLICY = { zdr: true } as const;

const completionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
    .min(1),
  usage: z
    .object({ prompt_tokens: z.number(), completion_tokens: z.number() })
    .optional(),
});
const transcriptionSchema = z.object({ text: z.string() });

const definiteFailures = new WeakSet<Error>();
/**
 * The vendor certainly did not serve the call: it answered with a refusal, or
 * the call was cancelled before it was sent. Nothing else is certain, since an
 * unreachable or unreadable call may still have been served and billed.
 */
export const isDefiniteProviderFailure = (error: unknown): boolean =>
  error instanceof Error && definiteFailures.has(error);
const definite = (error: Error) => {
  definiteFailures.add(error);
  return error;
};

/**
 * The OpenRouter adapter behind the TTS, STT and LLM ports. Every failure,
 * timeout or malformed answer is an `INFRASTRUCTURE` AppError whose cause
 * names the status only: a vendor's response body never travels further.
 */
export function createOpenRouter({
  apiKey,
  fetch,
  timeoutMs = 60_000,
  appUrl,
}: {
  readonly apiKey: string;
  readonly fetch: Fetch;
  readonly timeoutMs?: number;
  /** Sent as HTTP-Referer for OpenRouter's app attribution. */
  readonly appUrl?: string;
}) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-Title': 'Daisy',
    ...(appUrl ? { 'HTTP-Referer': appUrl } : {}),
  };
  const post = async (path: string, body: unknown, signal?: AbortSignal) => {
    if (signal?.aborted)
      throw definite(
        createAppError('CONFLICT', 'Provider operation cancelled'),
      );
    let response: Response;
    try {
      response = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      requireProviderNotCancelled(signal);
      throw createAppError(
        'INFRASTRUCTURE',
        `OpenRouter ${path} unreachable`,
        cause,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw definite(
        createAppError(
          'INFRASTRUCTURE',
          `OpenRouter ${path} answered ${response.status}`,
        ),
      );
    }
    return response;
  };
  const parse = <T>(schema: z.ZodType<T>, value: unknown, path: string): T => {
    const result = schema.safeParse(value);
    if (!result.success)
      throw createAppError(
        'INFRASTRUCTURE',
        `OpenRouter ${path} answered an unexpected shape`,
      );
    return result.data;
  };
  /** Reads an answer's body; a failure mid-read is an INFRASTRUCTURE error. */
  const reading = async <T>(
    path: string,
    read: () => Promise<T>,
    signal?: AbortSignal,
  ) => {
    try {
      requireProviderNotCancelled(signal);
      const result = await read();
      requireProviderNotCancelled(signal);
      return result;
    } catch (cause) {
      requireProviderNotCancelled(signal);
      if (isAppError(cause)) throw cause;
      throw createAppError(
        'INFRASTRUCTURE',
        `OpenRouter ${path} answer could not be read`,
        cause,
      );
    }
  };
  const chatBody = (request: CompletionRequest) => ({
    model: request.model,
    messages: request.messages,
    max_tokens: request.maxTokens,
    ...(request.temperature !== undefined
      ? { temperature: request.temperature }
      : {}),
    ...(request.json ? { response_format: { type: 'json_object' } } : {}),
    ...(request.reasoning
      ? { reasoning: { effort: request.reasoning, exclude: true } }
      : {}),
    provider: DATA_POLICY,
  });
  return {
    async complete(request: CompletionRequest) {
      const response = await post(
        '/chat/completions',
        chatBody(request),
        request.signal,
      );
      const body = parse(
        completionSchema,
        await reading(
          '/chat/completions',
          () => response.json(),
          request.signal,
        ),
        '/chat/completions',
      );
      return {
        text: body.choices[0]!.message.content ?? '',
        promptTokens: body.usage?.prompt_tokens ?? 0,
        completionTokens: body.usage?.completion_tokens ?? 0,
      };
    },
    /** Validated in-memory PCM for the server publication worker, never a transcript. */
    async speakPcm({
      model,
      voice,
      text,
      signal,
    }: {
      readonly model: string;
      readonly voice: string;
      readonly text: string;
      readonly signal?: AbortSignal;
    }) {
      requireSpeechNotCancelled(signal);
      const response = await post(
        '/audio/speech',
        {
          model,
          input: text,
          voice,
          response_format: 'pcm',
          provider: DATA_POLICY,
        },
        signal,
      );
      return reading('/audio/speech', () =>
        readPcmSpeech(response, text.length, signal),
      );
    },
    async transcribe({
      model,
      audioBase64,
      format,
      signal,
    }: {
      readonly model: string;
      readonly audioBase64: string;
      readonly format: 'webm' | 'ogg' | 'mp4' | 'wav';
      readonly signal?: AbortSignal;
    }) {
      const response = await post(
        '/audio/transcriptions',
        {
          model,
          input_audio: { data: audioBase64, format },
          language: 'en',
          provider: DATA_POLICY,
        },
        signal,
      );
      const body = parse(
        transcriptionSchema,
        await reading('/audio/transcriptions', () => response.json(), signal),
        '/audio/transcriptions',
      );
      return { text: body.text.trim() };
    },
  };
}

export type OpenRouter = ReturnType<typeof createOpenRouter>;
