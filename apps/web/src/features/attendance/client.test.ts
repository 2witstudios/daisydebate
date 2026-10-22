import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAttendanceClient } from './client';
setupRitewayBun();
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
    nextCommandId: () => 'same-command',
    send: async (c) => {
      sent.push(c.commandId);
      return ready;
    },
  });
  await client.update({ status: 'active', segments: [snapshot.segments[0]!] });
  ready = true;
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
