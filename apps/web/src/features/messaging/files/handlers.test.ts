import { assert, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../../server/test-loggers.test-support';
import { fileOperationFixture } from './operations.test-support';
import { createMessagingFileHandlers } from './handlers';
setupRitewayBun();
test('mounted file handlers authenticate before reading upload bytes or private dependencies', async () => {
  let protectedCalls = 0;
  const handlers = createMessagingFileHandlers({
    boundary: {
      logger: silentLogger,
      origin: () => 'https://example.test',
      identify: async () => ({
        state: 'anonymous',
        principal: { kind: 'anonymous' },
      }),
    },
    maxJsonBytes: 1024,
    bounds: { maxFileBytes: 1024, maxFilenameUnits: 50 },
    dependencies: () => {
      protectedCalls++;
      throw new Error('Unexpected private operation');
    },
  });
  const response = await handlers.upload(
    new Request('https://example.test/upload?generation=1', {
      method: 'POST',
      headers: {
        origin: 'https://example.test',
        'content-type': 'application/octet-stream',
      },
      body: new Uint8Array([1, 2, 3]),
    }),
    'c'.repeat(24),
    'f'.repeat(24),
  );
  assert({
    given: 'anonymous binary upload',
    should: 'refuse before private reservation/storage or body decoding',
    actual: [response.status, protectedCalls],
    expected: [401, 0],
  });
});
test('private file download passes current real operation fences and no object key or public location', async () => {
  const fixture = fileOperationFixture();
  const handlers = createMessagingFileHandlers({
    boundary: {
      logger: silentLogger,
      origin: () => 'https://example.test',
      identify: async () => ({
        state: 'member',
        username: 'ada',
        principal: fixture.principal,
      }),
    },
    maxJsonBytes: 1024,
    bounds: { maxFileBytes: 1024, maxFilenameUnits: 50 },
    dependencies: () => fixture.d,
  });
  const response = await handlers.download(
    new Request('https://example.test/file?generation=1'),
    fixture.input.channelId,
    fixture.input.fileId,
  );
  assert({
    given:
      'member requests a currently attached file through canonical read operation',
    should: 'serve only private bytes without key or token headers',
    actual: [
      response.status,
      response.headers.get('content-type'),
      response.headers.has('location'),
      new TextDecoder().decode(await response.arrayBuffer()),
      fixture.calls.filter((call) => call === 'read').length,
    ],
    expected: [200, 'application/pdf', false, '%PDF-1.7\nhello\n%%EOF', 1],
  });
  const foreign = await handlers.download(
    new Request('https://example.test/file?generation=1&objectKey=private'),
    fixture.input.channelId,
    fixture.input.fileId,
  );
  assert({
    given: 'client attempts to widen file token query',
    should: 'refuse undeclared object-key selector',
    actual: foreign.status,
    expected: 400,
  });
});

test('JSON attachment routes project versioned public tokens and pending cleanup avoids admission operations', async () => {
  const f = fileOperationFixture();
  const handlers = createMessagingFileHandlers({
    boundary: {
      logger: silentLogger,
      origin: () => 'https://example.test',
      identify: async () => ({
        state: 'member',
        username: 'ada',
        principal: f.principal,
      }),
    },
    maxJsonBytes: 1024,
    bounds: { maxFileBytes: 1024, maxFilenameUnits: 50 },
    dependencies: () => f.d,
  });
  const request = (body: unknown) =>
    new Request('https://example.test/files', {
      method: 'POST',
      headers: {
        origin: 'https://example.test',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  const reservation = await handlers.reserve(
    request({
      version: 1,
      channelId: f.channelId,
      requestId: 'r'.repeat(24),
      filename: 'notes.pdf',
      mime: 'application/pdf',
      bytes: 20,
    }),
  );
  const body = await reservation.json();
  const cleanup = await handlers.cleanup(
    request({
      version: 1,
      channelId: f.channelId,
      fileId: f.fileId,
      generation: 1,
    }),
  );
  assert({
    given: 'actual reserve operation and own pending-cleanup callback',
    should:
      'project only public reservation fields and invoke cleanup without posting/read frame',
    actual: [
      reservation.status,
      Object.keys(body).sort(),
      body.version,
      cleanup.status,
      f.state.cleanup,
      f.calls,
    ],
    expected: [
      200,
      [
        'bytes',
        'expiresAt',
        'fileId',
        'filename',
        'generation',
        'mime',
        'version',
      ],
      1,
      200,
      1,
      ['post'],
    ],
  });
  const listed = await handlers.list(
    new Request('https://example.test/files?messageId=' + f.messageId),
    f.channelId,
  );
  assert({
    given: 'current file-list port under read frame',
    should: 'return versioned empty metadata without keys',
    actual: await listed.json(),
    expected: { version: 1, files: [] },
  });
  const renewal = await handlers.renew(
    request({
      version: 1,
      channelId: f.channelId,
      fileId: f.fileId,
      generation: 1,
    }),
  );
  const cancelled = await handlers.cancel(
    request({
      version: 1,
      channelId: f.channelId,
      fileId: f.fileId,
      generation: 1,
    }),
  );
  assert({
    given:
      'current renewal and cancellation through the same mounted handler boundary',
    should: 'project only public renewed intent and await scoped cancel',
    actual: [
      renewal.status,
      Object.keys(await renewal.json()).sort(),
      cancelled.status,
      await cancelled.json(),
      f.state.commits,
    ],
    expected: [
      200,
      [
        'bytes',
        'expiresAt',
        'fileId',
        'filename',
        'generation',
        'mime',
        'version',
      ],
      200,
      { version: 1, cancelled: true },
      1,
    ],
  });
});
