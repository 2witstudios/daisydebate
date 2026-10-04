import { assertRejects } from '@daisy/errors/testing';
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

  test('refuses a line longer than the cap and stops reading', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(64)));
      },
      cancel() {
        cancelled = true;
      },
    });
    await assertRejects({
      given: 'a stream that never sends a newline, past a 100-character cap',
      should: 'reject with INFRASTRUCTURE',
      actual: async () => {
        for await (const line of readLines(body, 100)) void line;
      },
      code: 'INFRASTRUCTURE',
    });
    assert({
      given: 'that refusal',
      should: 'cancel the stream',
      actual: cancelled,
      expected: true,
    });
  });
});

describe('readLines, abandoned', () => {
  test('a reader that stops early cancels the stream', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('line\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const line of readLines(body)) if (line) break;
    assert({
      given: 'a consumer that takes one line and leaves',
      should: 'cancel the stream so the upstream request ends',
      actual: cancelled,
      expected: true,
    });
  });
});
