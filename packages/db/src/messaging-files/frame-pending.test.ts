import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  fileFrameFixture,
  fileRow,
  fileMessageRow,
  fileFramePolicy as policy,
  fileFrameNow as now,
  fileFrameCommand as command,
  fileFrameToken as token,
  fileFrameMessage as messageId,
} from './frame.test-support';
setupRitewayBun();

test('upload and scan return admitted metadata only for the applicable lifecycle', async () => {
  const f = fileFrameFixture([
    fileRow(),
    [[4]],
    fileRow({ lifecycle: 'quarantined', storedBytes: 20 }),
    [[4]],
    fileRow({ lifecycle: 'attached', messageId, storedBytes: 20 }),
    fileRow({ lifecycle: 'attached', messageId, storedBytes: 20 }),
  ]);
  const uploading = await f.frame.upload(token, now);
  const scanning = await f.frame.scan(token, now);
  const replayUpload = await f.frame.upload(token, '2026-10-09T18:00:05.000Z');
  const replayScan = await f.frame.scan(token, '2026-10-09T18:00:05.000Z');
  assert({
    given: 'pending admission and attached replays beyond reservation expiry',
    should: 'preserve lifecycle and immutable object without new mutations',
    actual: [
      uploading.lifecycle,
      scanning.lifecycle,
      replayUpload.lifecycle,
      replayScan.lifecycle,
      f.writes().length,
      f.remaining.length,
    ],
    expected: ['reserved', 'quarantined', 'attached', 'attached', 0, 0],
  });
});

for (const expired of [true, false]) {
  test(`pending upload rejects ${expired ? 'expired lease' : 'changed authority revision'}`, async () => {
    const f = fileFrameFixture(
      expired ? [fileRow({ expiresAt: new Date(now) })] : [fileRow(), [[5]]],
    );
    await assertRejects({
      given: 'a pending object whose original admission is no longer live',
      should: 'refuse replay',
      actual: () => f.frame.upload(token, now),
      code: 'CONFLICT',
    });
    assert({
      given: 'stale pending authority',
      should: 'leave stored state untouched',
      actual: f.writes().length,
      expected: 0,
    });
  });
}

test('missing channel or file never supplies protected metadata', async () => {
  for (const responses of [[[]], [fileRow(), []]]) {
    const f = fileFrameFixture(responses);
    await assertRejects({
      given: 'the locked association or its channel no longer exists',
      should: 'refuse upload',
      actual: () => f.frame.upload(token, now),
      code: 'NOT_FOUND',
    });
  }
});

for (const invalid of [
  { fileId: 'bad', generation: 1 },
  { ...token, generation: 0 },
  { ...token, generation: Number.NaN },
]) {
  test(`invalid file token ${JSON.stringify(invalid)}`, async () => {
    const f = fileFrameFixture([]);
    await assertRejects({
      given: 'an invalid untrusted token',
      should: 'reject after current authorization but before file lookup',
      actual: () => f.frame.upload(invalid, now),
      code: 'VALIDATION',
    });
    assert({
      given: 'invalid token refusal',
      should: 'consume only the authority fence',
      actual: [f.state.authorizations, f.calls.length],
      expected: [1, 0],
    });
  });
}

for (const bytes of [0, 61, 1.5]) {
  test(`quarantine refuses invalid stored size ${bytes}`, async () => {
    const f = fileFrameFixture([fileRow(), [[4]]]);
    await assertRejects({
      given: 'stored bytes outside the durable reservation',
      should: 'refuse quarantine without mutation',
      actual: () => f.frame.quarantine(token, bytes, now),
      code: 'CONFLICT',
    });
    assert({
      given: 'invalid storage completion',
      should: 'preserve the reserved charge',
      actual: f.writes().length,
      expected: 0,
    });
  });
}

test('pending-only transitions reject attached or unscanned lifecycle', async () => {
  for (const operation of [
    'scan',
    'renew',
    'quarantine',
    'finalize',
  ] as const) {
    const isScan = operation === 'scan';
    const row =
      isScan || operation === 'finalize'
        ? fileRow()
        : fileRow({ lifecycle: 'attached', messageId, storedBytes: 20 });
    const f = fileFrameFixture(
      operation === 'finalize' ? [row, fileMessageRow(), [[4]]] : [row, [[4]]],
    );
    const run = () => {
      if (operation === 'scan') return f.frame.scan(token, now);
      if (operation === 'renew') return f.frame.renew(token, now, policy);
      if (operation === 'quarantine') return f.frame.quarantine(token, 20, now);
      return f.frame.finalize(token, messageId, now, policy);
    };
    await assertRejects({
      given: `a lifecycle incompatible with ${operation}`,
      should: 'refuse the transition',
      actual: run,
      code: 'CONFLICT',
    });
    assert({
      given: 'a rejected lifecycle transition',
      should: 'emit no state mutation or bell',
      actual: f.writes().length,
      expected: 0,
    });
  }
});

test('reservation validates IDs, names, limits and time before persistence', async () => {
  const cases = [
    { value: { ...command, id: 'bad' }, time: now },
    { value: { ...command, objectKey: 'bad' }, time: now },
    { value: { ...command, requestId: 'bad' }, time: now },
    { value: { ...command, filename: '   ' }, time: now },
    { value: { ...command, bytes: 101 }, time: now },
    { value: command, time: 'not-a-time' },
  ];
  for (const { value, time } of cases) {
    const f = fileFrameFixture([]);
    await assertRejects({
      given: 'invalid native reservation transport data',
      should: 'refuse before metadata or quota lookup',
      actual: () => f.frame.reserve(value, time, policy),
      code: 'VALIDATION',
    });
    assert({
      given: 'invalid reservation',
      should: 'issue no persistence query',
      actual: f.calls.length,
      expected: 0,
    });
  }
});

test('request replay cannot change admitted content or resurrect an expired reservation', async () => {
  const changed = fileFrameFixture([fileRow(), [[4]]]);
  await assertRejects({
    given: 'same request identifier with different bytes',
    should: 'refuse conflicting content',
    actual: () => changed.frame.reserve({ ...command, bytes: 61 }, now, policy),
    code: 'CONFLICT',
  });
  const expired = fileFrameFixture([fileRow({ expiresAt: new Date(now) })]);
  await assertRejects({
    given: 'request replay after the original deadline',
    should: 'refuse resurrection',
    actual: () => expired.frame.reserve(command, now, policy),
    code: 'CONFLICT',
  });
  const attached = fileFrameFixture([
    fileRow({ lifecycle: 'attached', messageId, storedBytes: 20 }),
  ]);
  const replay = await attached.frame.reserve(
    command,
    '2026-10-09T18:00:05.000Z',
    policy,
  );
  assert({
    given: 'already attached immutable request replay',
    should: 'preserve the acknowledged association without a fresh reservation',
    actual: [
      replay.lifecycle,
      changed.writes().length,
      expired.writes().length,
      attached.writes().length,
    ],
    expected: ['attached', 0, 0, 0],
  });
});

test('invalid message ID, read time and pending reads refuse without writes', async () => {
  const invalidMessage = fileFrameFixture([
    fileRow({ lifecycle: 'quarantined', storedBytes: 20 }),
  ]);
  await assertRejects({
    given: 'an invalid message association identifier',
    should: 'refuse before message lookup',
    actual: () => invalidMessage.frame.finalize(token, 'bad', now, policy),
    code: 'VALIDATION',
  });
  const invalidTime = fileFrameFixture([
    fileRow({ lifecycle: 'attached', messageId, storedBytes: 20 }),
    [[null]],
  ]);
  await assertRejects({
    given: 'invalid access clock input',
    should: 'refuse protected access',
    actual: () => invalidTime.frame.access(token, 'not-a-time', policy),
    code: 'NOT_FOUND',
  });
  const pending = fileFrameFixture([fileRow()]);
  await assertRejects({
    given: 'an unattached reservation',
    should: 'refuse protected read access',
    actual: () => pending.frame.access(token, now, policy),
    code: 'NOT_FOUND',
  });
});
