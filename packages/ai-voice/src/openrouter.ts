import { createAppError } from '@daisy/errors';
import { z } from 'zod';

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type ChatMessage = {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
};

export type CompletionRequest = {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly maxTokens: number;
  readonly temperature?: number;
  /** Ask the model for a JSON object (structured output). */
  readonly json?: boolean;
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
const deltaSchema = z.object({
  choices: z.array(
    z.object({ delta: z.object({ content: z.string().nullish() }) }),
  ),
});
const transcriptionSchema = z.object({ text: z.string() });

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
      throw createAppError(
        'INFRASTRUCTURE',
        `OpenRouter ${path} unreachable`,
        cause,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw createAppError(
        'INFRASTRUCTURE',
        `OpenRouter ${path} answered ${response.status}`,
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
  const chatBody = (request: CompletionRequest, stream: boolean) => ({
    model: request.model,
    messages: request.messages,
    max_tokens: request.maxTokens,
    ...(request.temperature !== undefined
      ? { temperature: request.temperature }
      : {}),
    ...(request.json ? { response_format: { type: 'json_object' } } : {}),
    ...(stream ? { stream: true } : {}),
    provider: DATA_POLICY,
  });
  return {
    async complete(request: CompletionRequest) {
      const response = await post(
        '/chat/completions',
        chatBody(request, false),
      );
      const body = parse(
        completionSchema,
        await response.json(),
        '/chat/completions',
      );
      return {
        text: body.choices[0]!.message.content ?? '',
        promptTokens: body.usage?.prompt_tokens ?? 0,
        completionTokens: body.usage?.completion_tokens ?? 0,
      };
    },
    /** The completion's text deltas as the model writes them. */
    async *stream(
      request: CompletionRequest & { readonly signal?: AbortSignal },
    ) {
      const response = await post(
        '/chat/completions',
        chatBody(request, true),
        request.signal,
      );
      const reader = response.body?.getReader();
      if (!reader)
        throw createAppError('INFRASTRUCTURE', 'OpenRouter stream had no body');
      const decoder = new TextDecoder();
      let buffered = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice('data: '.length).trim();
          if (data === '[DONE]') return;
          let event: unknown;
          try {
            event = JSON.parse(data);
          } catch {
            throw createAppError(
              'INFRASTRUCTURE',
              'OpenRouter stream sent malformed data',
            );
          }
          const delta = parse(deltaSchema, event, '/chat/completions')
            .choices[0]?.delta.content;
          if (delta) yield delta;
        }
      }
    },
    async speak({
      model,
      voice,
      text,
    }: {
      readonly model: string;
      readonly voice: string;
      readonly text: string;
    }) {
      const response = await post('/audio/speech', {
        model,
        input: text,
        voice,
        response_format: 'mp3',
        provider: DATA_POLICY,
      });
      return { audio: await response.arrayBuffer(), characters: text.length };
    },
    async transcribe({
      model,
      audioBase64,
      format,
    }: {
      readonly model: string;
      readonly audioBase64: string;
      readonly format: 'webm' | 'ogg' | 'mp4' | 'wav';
    }) {
      const response = await post('/audio/transcriptions', {
        model,
        input_audio: { data: audioBase64, format },
        language: 'en',
        provider: DATA_POLICY,
      });
      const body = parse(
        transcriptionSchema,
        await response.json(),
        '/audio/transcriptions',
      );
      return { text: body.text.trim() };
    },
  };
}

export type OpenRouter = ReturnType<typeof createOpenRouter>;
