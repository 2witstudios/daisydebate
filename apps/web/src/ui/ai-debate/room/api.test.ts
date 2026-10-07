import { describe, test } from 'riteway/bun';
import { assert } from 'riteway/bun';
import { setupRitewayBun } from 'riteway/bun';
import { aiDebateApi } from './api';
import { schemas } from '../../../features/ai-debate/handlers';

setupRitewayBun();

/**
 * The browser client and the server's request schemas are two halves of one
 * contract, and nothing in the type system spans `fetch`. Each half was tested
 * against its own idea of that contract, so a rename landed on one side and
 * the mismatch stayed invisible until a member pressed a button: the
 * cutover's `expectedSequence` → `expectedVersion` and `turnIndex` →
 * `segmentIndex` both shipped that way.
 *
 * So: capture what the client actually puts on the wire, and parse it with
 * the handler's real schema. A rename on either side now fails here.
 */
const bodiesOf = async (
  call: () => Promise<unknown>,
): Promise<Record<string, unknown>> => {
  const sent: Record<string, unknown>[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    await call();
  } finally {
    globalThis.fetch = original;
  }
  return sent[0] ?? {};
};

describe('the browser speaks the schema the handler parses', () => {
  test('command carries expectedVersion', async () => {
    const body = await bodiesOf(() =>
      aiDebateApi.command('round-1', 7, { type: 'startPrep' }),
    );
    assert({
      given: 'a command posted by the browser',
      should: 'satisfy the handler schema, so the write can succeed',
      actual: schemas.command.safeParse(body).success,
      expected: true,
    });
  });

  test('transcribe carries segmentIndex', async () => {
    const body = await bodiesOf(() =>
      aiDebateApi.transcribe('round-1', 3, {
        base64: 'QUJDRA==',
        format: 'webm',
      }),
    );
    assert({
      given: 'a transcription posted by the browser',
      should: 'satisfy the handler schema',
      actual: schemas.transcribe.safeParse(body).success,
      expected: true,
    });
  });

  test('crossExamine carries segmentIndex', async () => {
    const body = await bodiesOf(() =>
      aiDebateApi.crossExamine('round-1', 2, {
        base64: 'QUJDRA==',
        format: 'webm',
      }),
    );
    assert({
      given: 'a cross-examination posted by the browser',
      should: 'satisfy the handler schema',
      actual: schemas.crossExamine.safeParse(body).success,
      expected: true,
    });
  });

  test('crossExamine without audio satisfies the schema', async () => {
    const body = await bodiesOf(() => aiDebateApi.crossExamine('round-1', 2));
    assert({
      given: 'an AI-led cross-examination with no recording',
      should: 'satisfy the handler schema, which makes audio optional',
      actual: schemas.crossExamine.safeParse(body).success,
      expected: true,
    });
  });

  test('speak and heard satisfy the handler schemas', async () => {
    const speak = await bodiesOf(() =>
      aiDebateApi.speak('round-1', 'utt-1', 0),
    );
    const heard = await bodiesOf(() =>
      aiDebateApi.heard({
        id: 'round-1',
        utteranceId: 'utt-1',
        phraseIndex: 0,
        playedMs: 0,
        totalMs: 0,
      }),
    );
    assert({
      given: 'a phrase fetch and a heard report',
      should: 'both satisfy the handler schemas',
      actual: {
        speak: schemas.speak.safeParse(speak).success,
        heard: schemas.heard.safeParse(heard).success,
      },
      expected: { speak: true, heard: true },
    });
  });

  // `speech` streams through fetch rather than `post`, so it gets its own case.
  test('the speech stream request satisfies the handler schema', async () => {
    const original = globalThis.fetch;
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      // An empty readable stream ends the loop immediately.
      return new Response(new ReadableStream({ start: (c) => c.close() }), {
        status: 200,
      });
    }) as typeof fetch;
    try {
      await aiDebateApi
        .speech('round-1', 4, () => undefined, new AbortController().signal)
        .catch(() => undefined);
    } finally {
      globalThis.fetch = original;
    }
    assert({
      given: 'a speech stream opened by the browser',
      should: 'satisfy the handler schema',
      actual: schemas.speech.safeParse(body).success,
      expected: true,
    });
  });
});
