/**
 * Answers the AI debate's OpenRouter calls for the browser suites, so the real
 * voice adapter, routes, room and capture worker run end to end with no
 * network and no key: a short streamed speech, a one-line cross-examination
 * reply, a transcript, a little silent audio and a fixed ballot. Test-only:
 * each e2e composition injects it as the `fetch` it already passes on.
 */
import { ballotCategories, ballotRubricVersion } from '@daisy/protocol';

const OPENROUTER = 'https://openrouter.ai/api/v1/';

/** The e2e compositions stub OpenRouter whenever their key is this placeholder. */
export const OPENROUTER_E2E_PLACEHOLDER =
  'sk-or-e2e-placeholder-not-a-credential';

const STUB_SPEECH = 'Thank you, judge. I stand firmly against the resolution.';
const STUB_REPLY = 'What is your strongest example?';
const STUB_TRANSCRIPT = 'My first contention is that it helps people.';
/** Three seconds of silent 24 kHz mono PCM for bot speech, which publishes PCM. */
const STUB_SPEECH_SAMPLES = 24000 * 3;
const stubScores = (score: number) =>
  ballotCategories.reduce<Record<string, number>>((scores, category) => {
    scores[category] = score;
    return scores;
  }, {});
const STUB_BALLOT = {
  rubricVersion: ballotRubricVersion,
  winner: 'affirmative',
  scores: {
    affirmative: stubScores(4),
    negative: stubScores(3),
  },
  reason: 'The affirmative answered every argument the negative made.',
  feedback: { affirmative: 'Clear claims and direct answers.' },
};

/** 0.25 s of silent 16-bit mono WAV, which the browser decodes like mp3. */
function silentWav(): ArrayBuffer {
  const rate = 8000;
  const samples = rate / 4;
  const bytes = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => {
    for (const [index, char] of [...value].entries())
      view.setUint8(offset + index, char.charCodeAt(0));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  return bytes;
}

/** Raw PCM when asked for it (bot speech), else a decodable silent WAV. */
const stubSpeech = (format: unknown) =>
  format === 'pcm'
    ? new Response(new Int16Array(STUB_SPEECH_SAMPLES), {
        headers: { 'content-type': 'audio/pcm;rate=24000;channels=1' },
      })
    : new Response(silentWav());

const streamed = (text: string) =>
  new Response(
    [...text.split(' ').map((word, index) => (index ? ` ${word}` : word))]
      .map(
        (delta) =>
          `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`,
      )
      .join('') + 'data: [DONE]\n\n',
  );

/** The stubbed answer for an OpenRouter request, or null for anything else. */
export function openRouterStub(
  input: string | URL | Request,
  init?: RequestInit,
): Response | null {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (!url.startsWith(OPENROUTER)) return null;
  const path = url.slice(OPENROUTER.length);
  const body = JSON.parse(String(init?.body ?? '{}')) as {
    stream?: boolean;
    response_format?: unknown;
  };
  if (path === 'audio/speech') return stubSpeech(body.response_format);
  if (path === 'audio/transcriptions')
    return Response.json({ text: STUB_TRANSCRIPT });
  if (body.stream) return streamed(STUB_SPEECH);
  const content = body.response_format
    ? JSON.stringify(STUB_BALLOT)
    : STUB_REPLY;
  return Response.json({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
}

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * `fetch` with OpenRouter answered by the stub when `apiKey` is the
 * placeholder; a real key (E2E_OPENROUTER_API_KEY, set by hand) reaches
 * OpenRouter through `fetch` unchanged.
 */
export const withOpenRouterStub = (
  apiKey: string | undefined,
  fetch: Fetch,
): Fetch =>
  apiKey === OPENROUTER_E2E_PLACEHOLDER
    ? async (input, init) => openRouterStub(input, init) ?? fetch(input, init)
    : fetch;
