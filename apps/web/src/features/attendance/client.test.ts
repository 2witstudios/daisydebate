import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAttendanceClient } from './client';
setupRitewayBun();
/** Each test's monotonic clock; a heartbeat test advances it past the back-off. */
const clock = { now: 0 };
const snapshot = {
  status: 'active' as const,
  segments: [
    { id: 'speech-a', type: 'speech' as const },
    { id: 'cx', type: 'cross_ex' as const },
    { id: 'speech-b', type: 'speech' as const },
  ],
};
test('HTTP attendance covers actual speech openings and historical unresolved windows without socket dependence', async () => {
  const sent: Array<{ segmentId: string; commandId: string }> = [];
  let next = 0;
  const client = createAttendanceClient({
    nowMs: () => clock.now,
    read: async () => null,
    nextCommandId: () => `command-${++next}`,
    send: async (command) => {
      sent.push(command);
      return true;
    },
  });
  await client.update(snapshot);
  await client.update(snapshot);
  await client.reconnect();
  assert({
    given: 'refresh plus reconnect in opponent speech',
    should:
      'send both actual speech windows over HTTP, preserve exact command retries, and omit CX',
    actual: sent,
    expected: [
      { segmentId: 'speech-b', commandId: 'command-2' },
      { segmentId: 'speech-a', commandId: 'command-1' },
      { segmentId: 'speech-b', commandId: 'command-2' },
      { segmentId: 'speech-a', commandId: 'command-1' },
    ],
  });
  await client.update({ ...snapshot, status: 'completed' });
  await client.reconnect();
  assert({
    given: 'terminal state',
    should: 'stop subsequent check-ins',
    actual: sent.length,
    expected: 4,
  });
});
test('unknown acknowledgement retries exact identity until receipt', async () => {
  const sent: string[] = [];
  let ready = false;
  const client = createAttendanceClient({
    nowMs: () => clock.now,
    read: async () => null,
    nextCommandId: () => 'same-command',
    send: async (c) => {
      sent.push(c.commandId);
      return ready;
    },
  });
  await client.update({ status: 'active', segments: [snapshot.segments[0]!] });
  ready = true;
  clock.now += 15_000;
  await client.heartbeat();
  await client.heartbeat();
  assert({
    given: 'first HTTP attempt lacks acknowledgement',
    should:
      'retry same command identity then stop periodic sends after durable receipt',
    actual: sent,
    expected: ['same-command', 'same-command'],
  });
});

test('closed historical windows retire permanently while current opening receives priority', async () => {
  const sent: string[] = [];
  let next = 0;
  const consumer = createAttendanceClient({
    nowMs: () => clock.now,
    read: async () => null,
    nextCommandId: () => String(++next),
    send: async (c) => {
      sent.push(c.segmentId);
      return c.segmentId === 'speech-a' ? 'closed' : true;
    },
  });
  await consumer.update(snapshot);
  await consumer.update(snapshot);
  await consumer.heartbeat();
  await consumer.reconnect();
  assert({
    given: 'old attendance window finalized before refresh',
    should:
      'prioritize current actual speech and never retry the retired historical window',
    actual: sent,
    expected: ['speech-b', 'speech-a', 'speech-b'],
  });
});

test('heartbeat discovers a persisted opening without a socket or resource-view update', async () => {
  const sent: string[] = [];
  const client = createAttendanceClient({
    nowMs: () => clock.now,
    read: async () => snapshot,
    nextCommandId: () => 'actual-opening-command',
    send: async (command) => {
      sent.push(command.segmentId);
      return true;
    },
  });
  await client.update({ status: 'active', segments: [] });
  await client.heartbeat();
  assert({
    given: 'a new actual speech only available through an authorized HTTP read',
    should:
      'discover and check in both actual historical speech rows without a doorbell',
    actual: sent,
    expected: ['speech-b', 'speech-a'],
  });
});

test('a late discovery response cannot restart a stopped or terminal consumer', async () => {
  for (const ending of ['stop', 'completed'] as const) {
    const sent: string[] = [];
    let answer!: (value: typeof snapshot) => void;
    let reading!: () => void;
    const opened = new Promise<void>((resolve) => {
      reading = resolve;
    });
    const client = createAttendanceClient({
      nowMs: () => clock.now,
      read: () => {
        reading();
        return new Promise((resolve) => {
          answer = resolve;
        });
      },
      nextCommandId: () => 'late-command',
      send: async (command) => {
        sent.push(command.segmentId);
        return true;
      },
    });
    const refresh = client.reconnect();
    await opened;
    if (ending === 'stop') client.stop();
    else await client.update({ status: ending, segments: [] });
    answer(snapshot);
    await refresh;
    await client.heartbeat();
    assert({
      given: `a pending read then ${ending}`,
      should: 'ignore late actual rows without creating post-lifetime requests',
      actual: sent,
      expected: [],
    });
  }
});

test('failed discovery preserves unknown command identity and historical receipt retries', async () => {
  const sent: string[] = [];
  const client = createAttendanceClient({
    nowMs: () => clock.now,
    read: async () => {
      throw new Error('Unavailable actual read');
    },
    nextCommandId: () => 'same-command',
    send: async (command) => {
      sent.push(command.commandId);
      return false;
    },
  });
  await client.update({ status: 'active', segments: [snapshot.segments[0]!] });
  await client.reconnect();
  assert({
    given: 'a failed snapshot refresh after an unknown check-in reply',
    should:
      'retain the same actual command rather than infer attendance or abandon retry',
    actual: sent,
    expected: ['same-command', 'same-command'],
  });
});

test('a 401 stops check-in for good and reports signed out once', async () => {
  let sends = 0;
  let reads = 0;
  let signedOut = 0;
  const client = createAttendanceClient({
    nowMs: () => clock.now,
    read: async () => {
      reads += 1;
      return snapshot;
    },
    nextCommandId: () => 'command',
    send: async () => {
      sends += 1;
      return 'signed-out';
    },
    signedOut: () => {
      signedOut += 1;
    },
  });
  await client.update(snapshot);
  await client.heartbeat();
  await client.reconnect();
  await client.update(snapshot);
  assert({
    given: 'check-in answered 401, then heartbeats, reconnects and views',
    should: 'send once, read nothing more, and report signed out once',
    actual: { sends, reads, signedOut },
    expected: { sends: 1, reads: 0, signedOut: 1 },
  });
});

test('a 401 on the Round read also signs the client out', async () => {
  let signedOut = 0;
  let sends = 0;
  const client = createAttendanceClient({
    nowMs: () => clock.now,
    read: async () => 'signed-out',
    nextCommandId: () => 'command',
    send: async () => {
      sends += 1;
      return true;
    },
    signedOut: () => {
      signedOut += 1;
    },
  });
  await client.heartbeat();
  await client.update(snapshot);
  assert({
    given: 'the read answering 401',
    should: 'stop before any check-in',
    actual: { signedOut, sends },
    expected: { signedOut: 1, sends: 0 },
  });
});

test('failing heartbeats back off; a reconnect retries at once', async () => {
  let now = 0;
  let sends = 0;
  const client = createAttendanceClient({
    read: async () => snapshot,
    nextCommandId: () => 'command',
    nowMs: () => now,
    send: async () => {
      sends += 1;
      return false;
    },
  });
  await client.update(snapshot);
  const afterUpdate = sends;
  now = 15_000;
  await client.heartbeat();
  const afterFirst = sends;
  now = 30_000;
  await client.heartbeat();
  const insideBackoff = sends;
  now = 45_000;
  await client.heartbeat();
  const afterSecond = sends;
  await client.reconnect();
  assert({
    given: 'every check-in unacknowledged, heartbeats every 15 s',
    should: 'skip heartbeats inside the growing wait and retry on reconnect',
    actual: [afterUpdate, afterFirst, insideBackoff, afterSecond, sends],
    expected: [2, 4, 4, 6, 8],
  });
});

test('the retry wait doubles from the heartbeat to a one-minute cap', async () => {
  const { ATTENDANCE_RETRY } = await import('./client');
  const { nextWaitMs } = await import('../../lib/idle-backoff');
  const waits: number[] = [];
  let previous: number | null = null;
  for (let failure = 0; failure < 5; failure += 1) {
    previous = nextWaitMs(ATTENDANCE_RETRY, previous, 'failed');
    waits.push(previous);
  }
  assert({
    given: 'five consecutive failing passes on the shared back-off',
    should: 'wait 15 s, then double to 60 s',
    actual: waits,
    expected: [15_000, 30_000, 60_000, 60_000, 60_000],
  });
});

test('a slow failing send still retries on the heartbeat its wait names', async () => {
  let now = 0;
  const attempts: number[] = [];
  const client = createAttendanceClient({
    read: async () => snapshot,
    nextCommandId: () => 'command',
    nowMs: () => now,
    send: async () => {
      if (!attempts.includes(now)) attempts.push(now);
      now += 200;
      return false;
    },
  });
  await client.update(snapshot);
  for (let tick = 15_000; tick <= 120_000; tick += 15_000) {
    now = tick;
    await client.heartbeat();
  }
  assert({
    given: 'sends that take 200 ms and always fail, heartbeats every 15 s',
    should: 'retry at 15 s, then 30 s and 60 s later, not a heartbeat late',
    // Each pass sends both speeches' check-ins, 200 ms apart: its first marks it.
    actual: attempts.filter((at) => at % 1_000 === 0),
    expected: [0, 15_000, 45_000, 105_000],
  });
});

test('inside the back-off a new speech is still checked in at once', async () => {
  let now = 0;
  const sent: string[] = [];
  let segments = [{ id: 'speech-a', type: 'speech' as const }];
  const client = createAttendanceClient({
    read: async () => ({ status: 'active', segments }),
    nextCommandId: () => `command-${sent.length}`,
    nowMs: () => now,
    send: async ({ segmentId }) => {
      sent.push(segmentId);
      return segmentId === 'speech-b';
    },
  });
  await client.heartbeat();
  now = 15_000;
  await client.heartbeat();
  now = 30_000;
  segments = [...segments, { id: 'speech-b', type: 'speech' as const }];
  await client.heartbeat();
  assert({
    given: 'one speech failing into its back-off, then a new speech opening',
    should: 'send the new speech on the next heartbeat',
    actual: sent.includes('speech-b'),
    expected: true,
  });
});

test('read latency never makes a heartbeat skip its retry', async () => {
  let now = 0;
  const attempts: number[] = [];
  const reads = [300, 100];
  const client = createAttendanceClient({
    read: async () => {
      now += reads[attempts.length % 2]!;
      return { status: 'active', segments: [snapshot.segments[0]!] };
    },
    nextCommandId: () => 'command',
    nowMs: () => now,
    send: async () => {
      attempts.push(now);
      now += 50;
      return false;
    },
  });
  for (let tick = 0; tick <= 120_000; tick += 15_000) {
    now = tick;
    await client.heartbeat();
  }
  assert({
    given: 'reads alternating 300 ms and 100 ms, sends always failing',
    should: 'retry on the 15 s, 30 s and 60 s heartbeats after each failure',
    actual: attempts.map((at) => Math.floor(at / 15_000) * 15_000),
    expected: [0, 15_000, 45_000, 105_000],
  });
});

test('view changes inside the back-off never retry a failing check-in', async () => {
  let now = 0;
  let sends = 0;
  const one = { status: 'active' as const, segments: [snapshot.segments[0]!] };
  const client = createAttendanceClient({
    read: async () => one,
    nextCommandId: () => 'command',
    nowMs: () => now,
    send: async () => {
      sends += 1;
      return false;
    },
  });
  await client.update(one);
  for (let push = 1; push <= 10; push += 1) {
    now = push * 1_000;
    await client.update(one);
  }
  assert({
    given: 'a failing check-in and a view push every second for 10 s',
    should: 'send once, then wait out the back-off',
    actual: sends,
    expected: 1,
  });
});

test('a check-in failing on a view push retries on the next heartbeat', async () => {
  let now = 0;
  const attempts: number[] = [];
  let segments: { id: string; type: 'speech' }[] = [];
  const client = createAttendanceClient({
    read: async () => ({ status: 'active', segments }),
    nextCommandId: () => 'command',
    nowMs: () => now,
    send: async () => {
      attempts.push(now);
      return false;
    },
  });
  await client.heartbeat();
  now = 7_000;
  segments = [{ id: 'speech-a', type: 'speech' }];
  await client.update({ status: 'active', segments });
  for (let tick = 15_000; tick <= 120_000; tick += 15_000) {
    now = tick;
    await client.heartbeat();
  }
  assert({
    given: 'a new speech pushed at 7 s whose check-in always fails',
    should: 'retry on the 15 s heartbeat, then 30 s and 60 s apart',
    actual: attempts,
    expected: [7_000, 15_000, 45_000, 105_000],
  });
});

test('a heartbeat a few ms early still takes its retry', async () => {
  let now = 3;
  const attempts: number[] = [];
  const one = { status: 'active' as const, segments: [snapshot.segments[0]!] };
  const client = createAttendanceClient({
    read: async () => one,
    nextCommandId: () => 'command',
    nowMs: () => now,
    send: async () => {
      attempts.push(now);
      return false;
    },
  });
  await client.heartbeat();
  now = 15_000;
  await client.heartbeat();
  assert({
    given: 'a failing heartbeat 3 ms late, the next on schedule',
    should: 'retry on that next heartbeat',
    actual: attempts,
    expected: [3, 15_000],
  });
});

test('stopping a client discards a queued resend while the in-flight command settles', async () => {
  const answer = Promise.withResolvers<boolean>();
  let sends = 0;
  let timeReads = 0;
  const client = createAttendanceClient({
    nowMs: () => ++timeReads,
    read: async () => null,
    nextCommandId: () => 'one-command',
    send: () => {
      sends += 1;
      return answer.promise;
    },
  });
  const current = client.update({
    status: 'active',
    segments: [snapshot.segments[0]!],
  });
  const reconnect = client.reconnect();
  await Promise.resolve();
  await Promise.resolve();
  client.stop();
  answer.resolve(true);
  await Promise.all([current, reconnect]);
  assert({
    given:
      'a stopped client with an in-flight command after a forced reconnect',
    should: 'settle the command without scheduling another attendance pass',
    actual: [sends, timeReads],
    expected: [1, 2],
  });
});
