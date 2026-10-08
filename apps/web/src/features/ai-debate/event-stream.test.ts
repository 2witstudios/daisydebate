import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { eventStream } from './event-stream';

setupRitewayBun();

const readAll = async (stream: ReadableStream<Uint8Array>) =>
  (await new Response(stream).text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string });

async function* events(...values: string[]) {
  for (const type of values) yield { type };
}

describe('eventStream', () => {
  test('keeps an idle speech stream alive while the next segment opens', async () => {
    let release = () => {};
    let pulse = () => {};
    async function* delayed() {
      yield { type: 'utterance' };
      await new Promise<void>((resolve) => (release = resolve));
      yield { type: 'phrase' };
    }
    const source = delayed();
    const first = await source.next();
    const reader = eventStream({
      first,
      events: source,
      abort: () => {},
      onFailure: () => {},
      heartbeat: (next) => {
        pulse = next;
        return () => {};
      },
    }).getReader();
    const decode = (chunk: Uint8Array | undefined) =>
      new TextDecoder().decode(chunk);
    const firstChunk = decode((await reader.read()).value);
    pulse();
    const keepalive = decode((await reader.read()).value);
    release();
    const phrase = decode((await reader.read()).value);
    await reader.cancel();
    assert({
      given: 'a model stream paused after its utterance id',
      should: 'send an ignorable blank line and then the next phrase',
      actual: { firstChunk, keepalive, phrase },
      expected: {
        firstChunk: '{"type":"utterance"}\n',
        keepalive: '\n',
        phrase: '{"type":"phrase"}\n',
      },
    });
  });

  test('sends each event as a line, then done', async () => {
    const source = events('a', 'b');
    const first = await source.next();
    assert({
      given: 'two events, the first already read',
      should: 'send both and then done',
      actual: (
        await readAll(
          eventStream({
            first,
            events: source,
            abort: () => {},
            onFailure: () => {},
          }),
        )
      ).map((e) => e.type),
      expected: ['a', 'b', 'done'],
    });
  });

  test('a failure ends the stream with an error line, reported once', async () => {
    async function* failing() {
      yield { type: 'a' };
      throw new Error('vendor down');
    }
    const source = failing();
    const first = await source.next();
    const failures: unknown[] = [];
    const types = (
      await readAll(
        eventStream({
          first,
          events: source,
          abort: () => {},
          onFailure: (error) => failures.push(error),
        }),
      )
    ).map((e) => e.type);
    assert({
      given: 'a source that fails after one event',
      should: 'send the event, then error, and report the failure once',
      actual: { types, failures: failures.length },
      expected: { types: ['a', 'error'], failures: 1 },
    });
  });

  test('a listener who leaves stops the source without a failure', async () => {
    let returned = false;
    let aborted = false;
    async function* endless() {
      try {
        for (;;) yield { type: 'a' };
      } finally {
        returned = true;
      }
    }
    const source = endless();
    const first = await source.next();
    const failures: unknown[] = [];
    const stream = eventStream({
      first,
      events: source,
      abort: () => {
        aborted = true;
      },
      onFailure: (error) => failures.push(error),
    });
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    assert({
      given: 'a listener that reads one line and leaves',
      should: 'abort the model, end the source and report nothing',
      actual: { aborted, returned, failures: failures.length },
      expected: { aborted: true, returned: true, failures: 0 },
    });
  });
});
