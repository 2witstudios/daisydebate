import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sseData } from './sse';

setupRitewayBun();

const bodyOf = (chunks: readonly string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
const read = async (chunks: readonly string[]) => {
  const data: string[] = [];
  for await (const payload of sseData(bodyOf(chunks))) data.push(payload);
  return data;
};

describe('sseData', () => {
  test('reads each event as it completes', async () => {
    assert({
      given: 'events split across network chunks, a comment and CRLF breaks',
      should: 'yield each data payload once, in order',
      actual: await read([
        ': keep-alive\n\nda',
        'ta: {"a":',
        '1}\n',
        '\ndata:two\r\n\r\ndata: [DONE]\n\n',
      ]),
      expected: ['{"a":1}', 'two', '[DONE]'],
    });
    assert({
      given: 'a body that ends inside an event',
      should: 'drop the unfinished event',
      actual: await read(['data: whole\n\ndata: unfini']),
      expected: ['whole'],
    });
    assert({
      given: 'an event with several data lines',
      should: 'join them with a line break',
      actual: await read(['data: a\ndata: b\n\n']),
      expected: ['a\nb'],
    });
  });
});

test('a CRLF split across two network chunks is one line break', async () => {
  const data: string[] = [];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of [
        'data: {"a":\r',
        '\ndata: 1}\r\n\r',
        '\ndata: end\r\r',
      ])
        controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  for await (const payload of sseData(body)) data.push(payload);
  assert({
    given: 'chunks that end between the CR and the LF of a line break',
    should: 'keep each event whole, and still end an event at CR line breaks',
    actual: data,
    expected: ['{"a":\n1}', 'end'],
  });
});

test('a body that never ends a line or an event is refused, not buffered without end', async () => {
  const flood = (chunk: string) =>
    new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode(chunk));
      },
    });
  const read = async (body: ReadableStream<Uint8Array>) => {
    try {
      for await (const payload of sseData(body)) void payload;
      return 'ended';
    } catch (error) {
      return (error as { code?: string }).code;
    }
  };
  assert({
    given:
      'a body with no line break, and one with data lines but no blank line',
    should: 'fail both as INFRASTRUCTURE once past the bound',
    actual: [
      await read(flood('x'.repeat(65536))),
      await read(flood(`data: ${'x'.repeat(65536)}\n`)),
    ],
    expected: ['INFRASTRUCTURE', 'INFRASTRUCTURE'],
  });
});
