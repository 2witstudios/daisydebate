/**
 * Answers the AI debate's OpenRouter calls inside the browser suite's server,
 * so the real voice adapter, routes and room run end to end with no network
 * and no key: a short streamed speech, a one-line cross-examination reply, a
 * transcript, a little silent audio and a fixed ballot. Test-only, wired
 * through `createApp`'s `fetch` like the mail capture.
 */
import { ballotCategories, ballotRubricVersion } from '@daisy/protocol';

const OPENROUTER = 'https://openrouter.ai/api/v1/';

/** The e2e server stubs OpenRouter whenever its key is this placeholder. */
export const OPENROUTER_E2E_PLACEHOLDER =
  'sk-or-e2e-placeholder-not-a-credential';

export const STUB_SPEECH =
  'Thank you, judge. I stand firmly against the resolution.';
export const STUB_REPLY = 'What is your strongest example?';
export const STUB_TRANSCRIPT = 'My first contention is that it helps people.';
const stubScores = (score: number) =>
  ballotCategories.reduce<Record<string, number>>((scores, category) => {
    scores[category] = score;
    return scores;
  }, {});
export const STUB_BALLOT = {
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
  if (path === 'audio/speech') return new Response(silentWav());
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
