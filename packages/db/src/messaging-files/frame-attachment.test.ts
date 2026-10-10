import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  fileFrameFixture,
  fileRow,
  fileMessageRow,
  fileFramePolicy as policy,
  fileFrameScope as scope,
  fileFrameNow as now,
  fileFrameToken as token,
  fileFrameMessage as messageId,
} from './frame.test-support';
setupRitewayBun();

const quarantined = () =>
  fileRow({ lifecycle: 'quarantined', storedBytes: 20 });
const attached = () =>
  fileRow({ lifecycle: 'attached', storedBytes: 20, messageId });

test('attachment replay is idempotent and announces one content-free committed mutation', async () => {
  const f = fileFrameFixture([
    quarantined(),
    fileMessageRow(),
    [[4]],
    [['0']],
    [],
    [],
    [[1n, '100']],
    [],
    attached(),
    fileMessageRow(),
  ]);
  await f.frame.finalize(token, messageId, now, policy);
  await f.frame.finalize(token, messageId, '2026-10-09T18:00:02.000Z', policy);
  const bell = f
    .writes()
    .find((call) => call.query.startsWith('insert into "outbox"'));
  assert({
    given:
      'valid quarantine attached then retried after its reservation deadline',
    should:
      'write one association, one channel revision and one bell without duplicating attachment',
    actual: [
      f.writes().length,
      f.counters.changeVersion,
      f.remaining.length,
      f.state.authorizations,
    ],
    expected: [3, 11, 0, 2],
  });
  assert({
    given: 'the actual outbox payload and same-transaction notification',
    should: 'contain only canonical invalidation fields and bind its position',
    actual: [
      bell?.params.find((value) => typeof value === 'object' && value !== null),
      f.calls
        .filter((call) => call.query.includes('pg_notify'))
        .map((call) => call.params),
    ],
    expected: [
      {
        kind: 'channel.changed',
        channelId: scope.channelId,
        changeVersion: 11,
      },
      [['100:1']],
    ],
  });
});

for (const message of [
  [],
  fileMessageRow({ removedAt: new Date(now), text: null }),
  fileMessageRow({ authorActorId: 'p'.repeat(24) }),
]) {
  test(`invalid authored message association ${JSON.stringify(message)}`, async () => {
    const f = fileFrameFixture([quarantined(), message]);
    await assertRejects({
      given: 'a missing, removed or foreign-authored message',
      should: 'refuse attachment before any mutation',
      actual: () => f.frame.finalize(token, messageId, now, policy),
      code: 'NOT_FOUND',
    });
    assert({
      given: 'rejected message association',
      should: 'bind the channel/message and leave quarantine untouched',
      actual: [f.calls[1]!.params, f.writes().length],
      expected: [[messageId, scope.channelId], 0],
    });
  });
}

test('message attachment count refuses before publishing a mutation', async () => {
  const f = fileFrameFixture([quarantined(), fileMessageRow(), [[4]], [['1']]]);
  await assertRejects({
    given: 'a message already at its injected attachment count',
    should: 'refuse excess attachment',
    actual: () => f.frame.finalize(token, messageId, now, policy),
    code: 'PAYLOAD_TOO_LARGE',
  });
  assert({
    given: 'attachment capacity refusal',
    should: 'leave both file and notification version unchanged',
    actual: [f.writes().length, f.counters.changeVersion],
    expected: [0, 10],
  });
});

test('surviving authorized reader accesses attached content independently of reservation expiry and ownership', async () => {
  const f = fileFrameFixture([
    fileRow({
      lifecycle: 'attached',
      messageId,
      storedBytes: 20,
      ownerActorId: 'p'.repeat(24),
      authorityRevision: 1,
    }),
    [[null]],
  ]);
  const access = await f.frame.access(
    token,
    '2026-10-09T18:00:02.000Z',
    policy,
  );
  assert({
    given: 'a current authorized peer after the original reservation expired',
    should: 'return bounded read access without modifying shared content',
    actual: [
      access.storedBytes,
      access.messageId,
      access.accessExpiresAt,
      f.writes().length,
    ],
    expected: [20, messageId, '2026-10-09T18:00:02.100Z', 0],
  });
});

for (const message of [[], [[new Date(now)]]]) {
  test(`read refuses unavailable attached message ${JSON.stringify(message)}`, async () => {
    const f = fileFrameFixture([attached(), message]);
    await assertRejects({
      given: 'attached file whose message disappeared or was removed',
      should: 'refuse protected access',
      actual: () => f.frame.access(token, now, policy),
      code: 'NOT_FOUND',
    });
  });
}

for (const lifecycle of ['reserved', 'attached'] as const) {
  test(`cancellation of ${lifecycle} file retains unacknowledged charge`, async () => {
    const f = fileFrameFixture(
      lifecycle === 'attached'
        ? [attached(), [], [], [[1n, '100']], []]
        : [fileRow(), []],
    );
    await f.frame.cancel(token);
    const update = f.writes()[0]!;
    assert({
      given: 'an authorized cancellation',
      should:
        'scrub metadata and advance generation without releasing charged bytes',
      actual: [
        update.params,
        update.query.includes('"generation" +'),
        update.query.includes('reserved_bytes'),
        f.counters.changeVersion,
      ],
      expected: [
        [null, null, null, null, 'deleting', token.fileId],
        true,
        false,
        lifecycle === 'attached' ? 11 : 10,
      ],
    });
  });
}
