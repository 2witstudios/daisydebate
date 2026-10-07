import { readLines, type Ballot } from '@daisy/ai-voice';
import type { AiDebateView } from '../../../features/ai-debate/operations';

/** A refused or failed AI debate request, with the public error code. */
export class AiDebateRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`AI debate request failed: ${status} ${code}`);
  }
}

const post = async (path: string, body: unknown): Promise<Response> => {
  const response = await fetch(`/api/ai-debate/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new AiDebateRequestError(
      response.status,
      error?.error?.code ?? 'UNKNOWN',
    );
  }
  return response;
};

export type RecordedAudio = {
  readonly base64: string;
  readonly format: 'webm' | 'ogg' | 'mp4';
};

/** The browser recording as base64 plus the format the transcriber needs. */
export async function encodeRecording(blob: Blob): Promise<RecordedAudio> {
  const type = blob.type;
  const format = type.includes('mp4')
    ? 'mp4'
    : type.includes('ogg')
      ? 'ogg'
      : 'webm';
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { base64: btoa(binary), format };
}

export type SpeechEvent =
  | { readonly type: 'utterance'; readonly id: string }
  | { readonly type: 'phrase'; readonly index: number; readonly text: string }
  | { readonly type: 'done' }
  | { readonly type: 'error' };

export const aiDebateApi = {
  async view(id: string): Promise<AiDebateView> {
    const response = await fetch(
      `/api/ai-debate/view?id=${encodeURIComponent(id)}`,
    );
    if (!response.ok) throw new AiDebateRequestError(response.status, 'VIEW');
    return (await response.json()) as AiDebateView;
  },
  async command(
    id: string,
    expectedSequence: number,
    command:
      | { type: 'start' }
      | { type: 'startPrep' }
      | { type: 'startSpeech' }
      | { type: 'yield' }
      | { type: 'abort' },
  ) {
    await post('command', { id, expectedSequence, command });
  },
  async transcribe(id: string, turnIndex: number, audio: RecordedAudio) {
    const response = await post('transcribe', {
      id,
      turnIndex,
      audio: audio.base64,
      format: audio.format,
    });
    return (await response.json()) as { text: string };
  },
  /** Streams the AI's speech: an utterance id, then each phrase as written. */
  async speech(
    id: string,
    turnIndex: number,
    onEvent: (event: SpeechEvent) => void,
    signal: AbortSignal,
  ) {
    const response = await fetch('/api/ai-debate/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, turnIndex }),
      signal,
    });
    if (!response.ok || !response.body)
      throw new AiDebateRequestError(response.status, 'SPEECH');
    for await (const line of readLines(response.body))
      if (line.trim()) onEvent(JSON.parse(line) as SpeechEvent);
  },
  async speak(
    id: string,
    utteranceId: string,
    phraseIndex: number,
  ): Promise<ArrayBuffer> {
    const response = await post('speak', { id, utteranceId, phraseIndex });
    return response.arrayBuffer();
  },
  async crossExamine(id: string, turnIndex: number, audio?: RecordedAudio) {
    const response = await post('cross-examine', {
      id,
      turnIndex,
      ...(audio ? { audio } : {}),
    });
    return (await response.json()) as {
      heard: string;
      reply: { utteranceId: string; phrases: string[] } | null;
    };
  },
  async heard(input: {
    id: string;
    utteranceId: string;
    phraseIndex: number;
    playedMs: number;
    totalMs: number;
  }) {
    await post('heard', input);
  },
  async ballot(id: string): Promise<Ballot> {
    const response = await post('ballot', { id });
    return (await response.json()) as Ballot;
  },
};

export type AiDebateApi = typeof aiDebateApi;
