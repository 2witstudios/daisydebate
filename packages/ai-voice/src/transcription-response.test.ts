import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createOpenRouter } from './openrouter';
setupRitewayBun();
const transcribe = (response: Response) =>
  createOpenRouter({
    apiKey: 'unit-only',
    fetch: async () => response,
  }).transcribe({
    model: 'controlled-model',
    audioBase64: 'AA==',
    format: 'wav',
  });
for (const oversized of ['utf8', 'whitespace', 'declared', 'streamed'] as const)
  test(`transcription refuses ${oversized} excess before returning provider text`, async () => {
    const data =
      oversized === 'utf8'
        ? 'é'.repeat(32769)
        : oversized === 'whitespace'
          ? ' '.repeat(65537)
          : 'x'.repeat(1024 * 1024);
    const response =
      oversized === 'declared'
        ? new Response('{"text":"short"}', {
            headers: { 'content-length': String(1024 * 1024 + 1) },
          })
        : Response.json({ text: data });
    await assertRejects({
      given: `${oversized} oversized provider response`,
      should:
        'refuse with sanitized infrastructure error instead of returning unbounded or trimmed-away text',
      actual: () => transcribe(response),
      code: 'INFRASTRUCTURE',
    });
  });
test('malformed transcription JSON cannot expose transcript fragments in its error chain', async () => {
  const marker = 'private-controlled-fragment';
  let failure: unknown;
  try {
    await transcribe(new Response('{"text": "' + marker));
  } catch (error) {
    failure = error;
  }
  const messages: string[] = [];
  for (let error = failure; error instanceof Error; error = error.cause)
    messages.push(error.message);
  assert({
    given:
      'provider JSON containing a private controlled fragment and invalid syntax',
    should:
      'report the failure without retaining any vendor fragment in nested error messages',
    actual: {
      rejected: failure instanceof Error,
      leaked: messages.join(' ').includes(marker),
    },
    expected: { rejected: true, leaked: false },
  });
});
test('a response stream failure cannot retain provider fragments as its cause', async () => {
  const marker = 'controlled-private-stream-error';
  let failure: unknown;
  try {
    await transcribe(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error(marker));
          },
        }),
      ),
    );
  } catch (error) {
    failure = error;
  }
  const messages: string[] = [];
  for (let error = failure; error instanceof Error; error = error.cause)
    messages.push(error.message);
  assert({
    given: 'a failed provider stream with private text in its rejection',
    should: 'return only the safe infrastructure failure',
    actual: {
      rejected: failure instanceof Error,
      leaked: messages.join(' ').includes(marker),
    },
    expected: { rejected: true, leaked: false },
  });
});
test('oversized chunked response stops early, cancels and unlocks its reader', async () => {
  let produced = 0,
    cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      produced++;
      controller.enqueue(new Uint8Array(65536));
      if (produced === 80) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  await assertRejects({
    given:
      'five MiB of chunked provider output without a Content-Length header',
    should: 'refuse at the byte envelope without reading the entire response',
    actual: () => transcribe(new Response(body)),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'the oversized response refusal',
    should:
      'cancel the producer and release its reader before exhausting the stream',
    actual: { early: produced < 80, cancelled, locked: body.locked },
    expected: { early: true, cancelled: true, locked: false },
  });
});
test('a bounded envelope can include ignored metadata without shrinking the text budget', async () => {
  const text = 'é'.repeat(32768);
  const result = await transcribe(
    Response.json({ text, extension: 'x'.repeat(800000) }),
  );
  assert({
    given: 'exactly64KiB UTF8 text inside a sub-MiB JSON response',
    should: 'preserve the entire valid transcript without truncation',
    actual: result.text === text,
    expected: true,
  });
});
