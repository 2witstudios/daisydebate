import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readLines } from './lines';

setupRitewayBun();

describe('readLines', () => {
  test('yields whole lines across chunk boundaries', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"a":1}\n{"b"'));
        controller.enqueue(encoder.encode(':2}\ntail'));
        controller.close();
      },
    });
    const lines: string[] = [];
    for await (const line of readLines(body)) lines.push(line);
    assert({
      given: 'a line split across two chunks and an unterminated tail',
      should: 'yield each whole line and the tail',
      actual: lines,
      expected: ['{"a":1}', '{"b":2}', 'tail'],
    });
  });
});
