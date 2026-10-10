import { assert, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../../server/test-loggers.test-support';
import { fileOperationFixture } from './operations.test-support';
import { createMessagingFileHandlers } from './handlers';
import { nativeFileHandler } from './native-handler';
import { nativeFileResponse } from './form-response';
setupRitewayBun();
test('multipart attachment authenticates before decode and enforces its independently injected stream bound', async () => {
  const fixture = fileOperationFixture();
  let member = false,
    calls = 0;
  const boundary = {
    logger: silentLogger,
    origin: () => 'https://example.test',
    identify: async () =>
      member
        ? {
            state: 'member' as const,
            username: 'ada',
            principal: fixture.principal,
          }
        : {
            state: 'anonymous' as const,
            principal: { kind: 'anonymous' as const },
          },
  };
  const files = createMessagingFileHandlers({
    boundary,
    maxJsonBytes: 1024,
    bounds: { maxFileBytes: 1024, maxFilenameUnits: 50 },
    dependencies: () => {
      calls++;
      return fixture.d;
    },
  });
  const input = {
    boundary,
    files,
    maxMultipartBytes: 8,
    respond: () => Response.json({}),
  };
  const request = () =>
    new Request('https://example.test/attach', {
      method: 'POST',
      headers: {
        origin: 'https://example.test',
        'content-type': 'multipart/form-data; boundary=native',
      },
      body: new Uint8Array(9),
    });
  const anonymous = await nativeFileHandler(
    input,
    request(),
    'c'.repeat(24),
    'm'.repeat(24),
  );
  member = true;
  const bounded = await nativeFileHandler(
    input,
    request(),
    'c'.repeat(24),
    'm'.repeat(24),
  );
  const malformed = await nativeFileHandler(
    { ...input, maxMultipartBytes: 1024 },
    request(),
    'c'.repeat(24),
    'm'.repeat(24),
  );
  assert({
    given: 'malformed multipart envelope within its bound',
    should: 'refuse as input validation before private I/O',
    actual: [malformed.status, calls],
    expected: [400, 0],
  });
  assert({
    given: 'anonymous or oversized multipart body',
    should: 'refuse without reservation/scanner/storage access',
    actual: [anonymous.status, bounded.status, calls],
    expected: [401, 413, 0],
  });
});
test('native retry response keeps only escaped filename/request intent and uses a fresh chooser', async () => {
  const response = nativeFileResponse('c'.repeat(24), 'm'.repeat(24), {
    requestId: 'r'.repeat(24),
    filename: '<script>private.pdf</script>',
    notice: 'Choose it again.',
  });
  const html = await response.text();
  assert({
    given: 'untrusted retained filename after refused attachment',
    should:
      'render text rather than executable markup and retain retry ID without bytes',
    actual: [
      html.includes('<script>'),
      html.includes('&lt;script&gt;'),
      html.includes('name="requestId"'),
      html.includes('type="file"'),
      response.headers.has('location'),
    ],
    expected: [false, true, true, true, false],
  });
});

test('native pending discard preserves canonical refusal and infrastructure status without a posting grant', async () => {
  const { nativeFileCleanup } = await import('./native-cleanup-handler');
  const fixture = fileOperationFixture();
  let status = 503,
    calls = 0;
  const input = {
    boundary: {
      logger: silentLogger,
      origin: () => 'https://example.test',
      identify: async () => ({
        state: 'member' as const,
        username: 'ada',
        principal: fixture.principal,
      }),
    },
    maxBodyBytes: 1024,
    bounds: { maxFileBytes: 1024, maxFilenameUnits: 50 },
    cleanup: async () => {
      calls++;
      return Response.json({ unavailable: true }, { status });
    },
  };
  const request = () =>
    new Request('https://example.test/discard', {
      method: 'POST',
      headers: {
        origin: 'https://example.test',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ fileId: fixture.fileId, generation: '1' }),
    });
  const held = await nativeFileCleanup(input, request(), fixture.channelId);
  status = 200;
  const cleaned = await nativeFileCleanup(input, request(), fixture.channelId);
  assert({
    given: 'real cleanup transport reports outage then success',
    should: 'preserve refusal and move on only after acknowledgement',
    actual: [
      held.status,
      cleaned.status,
      cleaned.headers.get('location'),
      calls,
    ],
    expected: [503, 303, `/messages/${fixture.channelId}`, 2],
  });
});

test('native multipart carries real reserve/upload/scan/finalize operations and keeps a discard token after revocation', async () => {
  for (const revoked of [false, true]) {
    const fixture = fileOperationFixture();
    const pdf = '%PDF-1.7\nhello\n%%EOF';
    fixture.frame.reserve = async () => ({
      ...fixture.reservation,
      reservedBytes: new TextEncoder().encode(pdf).length,
    });
    const boundary = {
      logger: silentLogger,
      origin: () => 'https://example.test',
      identify: async () => ({
        state: 'member' as const,
        username: 'ada',
        principal: fixture.principal,
      }),
    };
    const policy = fixture.d.policy;
    if (!policy) throw new Error('Explicit fixture policy required');
    const files = createMessagingFileHandlers({
      boundary,
      maxJsonBytes: 1024,
      bounds: policy,
      dependencies: () => fixture.d,
    });
    const form = new FormData();
    form.set('requestId', 'r'.repeat(24));
    form.set('file', new File([pdf], 'notes.pdf', { type: 'application/pdf' }));
    const response = nativeFileHandler(
      {
        boundary,
        files,
        maxMultipartBytes: 2048,
        respond: (state) =>
          nativeFileResponse(fixture.channelId, fixture.messageId, state),
      },
      new Request('https://example.test/attach', {
        method: 'POST',
        headers: { origin: 'https://example.test' },
        body: form,
      }),
      fixture.channelId,
      fixture.messageId,
    );
    await fixture.scanStarted;
    fixture.state.allowed = !revoked;
    fixture.completeScan('clean');
    const result = await response;
    const html = await result.text();
    assert({
      given: revoked
        ? 'canonical posting revoked while native scan is pending'
        : 'bounded native multipart passes current operation fences',
      should: revoked
        ? 'keep escaped retry and own pending discard without a false success redirect'
        : 'redirect only after current finalize commits',
      actual: [
        result.status,
        result.headers.get('location'),
        fixture.calls.includes('finalize'),
        html.includes('Discard pending upload'),
        html.includes(fixture.reservation.objectKey),
      ],
      expected: [
        revoked ? 200 : 303,
        revoked ? null : `/messages/${fixture.channelId}`,
        !revoked,
        revoked,
        false,
      ],
    });
  }
});
