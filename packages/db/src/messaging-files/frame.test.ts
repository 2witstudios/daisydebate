import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  fileFrameFixture,
  fileRow,
  fileFramePolicy as policy,
  fileFrameScope as scope,
  fileFrameNow as now,
  fileFrameCommand as command,
  fileFrameToken as token,
  fileFrameMessage as messageId,
} from './frame.test-support';
setupRitewayBun();

test('file admission binds durable authority and replay preserves the existing reservation', async () => {
  const f = fileFrameFixture([
    [],
    [['0', '0']],
    [[4]],
    fileRow(),
    fileRow(),
    [[4]],
  ]);
  const admitted = await f.frame.reserve(command, now, policy);
  const replay = await f.frame.reserve(
    { ...command, id: 'n'.repeat(24), objectKey: 'k'.repeat(24) },
    now,
    policy,
  );
  assert({
    given:
      'fresh admission followed by a same-request replay with newly allocated internal IDs',
    should: 'return the original durable reservation and write exactly once',
    actual: {
      replay,
      admitted,
      writes: f.writes().length,
      authorizations: f.state.authorizations,
      remaining: f.remaining.length,
    },
    expected: {
      replay: admitted,
      admitted,
      writes: 1,
      authorizations: 2,
      remaining: 0,
    },
  });
  assert({
    given: 'the actual persistence insertion',
    should: 'bind owner, channel, object, quota and current authority',
    actual: [
      scope.actorId,
      scope.channelId,
      command.objectKey,
      command.bytes,
      4,
    ].map((value) => f.writes()[0]!.params.includes(value)),
    expected: [true, true, true, true, true],
  });
});

for (const [bytes, count] of [
  ['150', '1'],
  ['0', '2'],
]) {
  test(`charged quota refuses admission at ${bytes} bytes and ${count} files`, async () => {
    const f = fileFrameFixture([[], [[bytes, count]]]);
    await assertRejects({
      given:
        'charged objects including pending deletion have exhausted one quota dimension',
      should: 'refuse before insertion',
      actual: () => f.frame.reserve(command, now, policy),
      code: 'PAYLOAD_TOO_LARGE',
    });
    assert({
      given: 'a refused charged admission',
      should:
        'leave durable state unchanged and exclude only acknowledged deleted rows',
      actual: [f.writes().length, f.calls[1]!.params.includes('deleted')],
      expected: [0, true],
    });
  });
}

test('every protected frame method refuses revoked authority before reading or writing', async () => {
  const f = fileFrameFixture([]);
  f.state.allowed = false;
  const operations = [
    () => f.frame.authorize(),
    () => f.frame.reserve(command, now, policy),
    () => f.frame.upload(token, now),
    () => f.frame.scan(token, now),
    () => f.frame.quarantine(token, 20, now),
    () => f.frame.renew(token, now, policy),
    () => f.frame.finalize(token, messageId, now, policy),
    () => f.frame.access(token, now, policy),
    () => f.frame.cancel(token),
  ];
  for (const operation of operations)
    await assertRejects({
      given: 'current authority is revoked',
      should: 'refuse before protected I/O',
      actual: operation,
      code: 'AUTHORIZATION',
    });
  assert({
    given: 'all rejected capabilities',
    should: 'issue no persistence query',
    actual: f.calls.length,
    expected: 0,
  });
});

for (const [overrides, code] of [
  [{ ownerActorId: 'p'.repeat(24) }, 'NOT_FOUND'],
  [{ lifecycle: 'deleting' }, 'NOT_FOUND'],
  [{ lifecycle: 'deleted' }, 'NOT_FOUND'],
  [{ generation: 2 }, 'CONFLICT'],
] as const) {
  test(`upload refuses unavailable row ${JSON.stringify(overrides)}`, async () => {
    const f = fileFrameFixture([fileRow(overrides)]);
    await assertRejects({
      given: 'a foreign, removed or superseded file',
      should: 'refuse protected upload',
      actual: () => f.frame.upload(token, now),
      code,
    });
    assert({
      given: 'file lookup',
      should: 'lock and bind the requested channel/file without writing',
      actual: [
        f.calls[0]!.params,
        f.calls[0]!.query.includes('for update'),
        f.writes().length,
      ],
      expected: [[token.fileId, scope.channelId], true, 0],
    });
  });
}

test('quarantine and renewal preserve byte charges while fencing old generations', async () => {
  const f = fileFrameFixture([
    fileRow(),
    [[4]],
    [],
    fileRow({ lifecycle: 'quarantined', storedBytes: 20 }),
    [[4]],
    [[4]],
    fileRow({ lifecycle: 'quarantined', storedBytes: 20, generation: 2 }),
  ]);
  await f.frame.quarantine(token, 20, now);
  const renewed = await f.frame.renew(token, now, policy);
  assert({
    given: 'admitted storage followed by generation renewal',
    should:
      'keep the reserved charge and advance only current authority fields',
    actual: [
      renewed.generation,
      renewed.reservedBytes,
      f
        .writes()
        .map((call) =>
          call.query.split(' returning ')[0]!.includes('reserved_bytes'),
        ),
      f.remaining.length,
    ],
    expected: [2, 60, [false, false], 0],
  });
});
