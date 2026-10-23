/**
 * Answers the AI debate's OpenRouter calls for the browser suites, so the real
 * voice adapter, routes, room and capture worker run end to end with no
 * network and no key: a short streamed speech, a one-line cross-examination
 * reply, a transcript, three seconds of silent speech and a fixed ballot. Test-only:
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
/** Three seconds of bot speech. */
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

/** Silent 24 kHz mono PCM, the only speech format the adapter requests. */
const stubSpeech = () =>
  new Response(new Int16Array(STUB_SPEECH_SAMPLES), {
    headers: { 'content-type': 'audio/pcm;rate=24000;channels=1' },
  });

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
function openRouterStub(
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
  if (path === 'audio/speech') return stubSpeech();
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
