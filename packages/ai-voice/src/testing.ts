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

const side = (claim: string, id: 'A' | 'N') => ({
  thesis: { id, claim, line: id === 'A' ? '0.0' : '2.0' },
  framework: 'More true than false.',
  burdens: [
    {
      id: `${id}1`,
      claim: 'It helps people.',
      line: id === 'A' ? '0.1' : '2.1',
      warrants: [
        {
          id: `${id}1.1`,
          claim: 'People who cannot drive can reach work.',
          line: id === 'A' ? '0.2' : '2.2',
          kind: 'reasoning' as const,
        },
      ],
    },
  ],
});

/** A valid case map (ADR 0125), the stub's answer to every case-map request. */
export const stubCaseMap = {
  about: {
    question: 'Does it help people more than it costs?',
    affirmative: 'It helps people.',
    negative: 'It costs more than it helps.',
  },
  cases: {
    affirmative: side('It helps people.', 'A'),
    negative: side('It costs more than it helps.', 'N'),
  },
  framework: {
    dispute: 'none',
    contested: [],
    ruling: 'The affirmative standard was uncontested.',
    liveBurdens: ['A1', 'N1'],
  },
  attacks: [],
  concessions: [],
  coherence: { affirmative: [], negative: [] },
  standing: { affirmative: ['A', 'A1'], negative: ['N', 'N1'] },
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
      .join('') +
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n` +
      'data: [DONE]\n\n',
  );

/** A schema-constrained request's answer: the case map, or the ballot. */
const structuredStub = (format: { json_schema?: { name?: string } }) =>
  JSON.stringify(
    format.json_schema?.name === 'case_map' ? stubCaseMap : STUB_BALLOT,
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
    response_format?: { json_schema?: { name?: string } };
  };
  if (path === 'audio/speech') return stubSpeech();
  if (path === 'audio/transcriptions')
    return Response.json({ text: STUB_TRANSCRIPT });
  if (body.stream) return streamed(STUB_SPEECH);
  const content = body.response_format
    ? structuredStub(body.response_format)
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
