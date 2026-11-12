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
