import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  buildDebateTopic,
  buildRoomTopic,
  ENVELOPE_VERSION,
  type ServerMessage,
} from '@daisy/protocol';
import { attachVersionDoorbell } from './doorbell';

setupRitewayBun();

const roomId = 'r'.repeat(24);
const roundId = 'd'.repeat(24);
const event = (
  topic: string,
  payload: Extract<ServerMessage, { type: 'event' }>['payload'],
): ServerMessage => ({
  v: ENVELOPE_VERSION,
  type: 'event',
  topic,
  position: '1:2',
  payload,
});

function harness(
  topic: string,
  kind: 'room.changed' | 'debate.phase-changed',
  id: string,
) {
  let emit: (frame: ServerMessage) => void = () => {};
  let error: (frame: ServerMessage) => void = () => {};
  const calls: (string | number | null)[] = [];
  const doorbell = attachVersionDoorbell({
    topic,
    kind,
    id,
    connection: {
      subscribeTopic: (subscribed, listener) => {
        calls.push(subscribed);
        emit = listener;
        return () => calls.push('unsubscribe');
      },
      onMessage: (listener) => {
        error = listener;
        return () => calls.push('stop errors');
      },
      resubscribeTopic: (subscribed) => calls.push(`retry:${subscribed}`),
    },
    signal: (version) => calls.push(version),
  });
  return {
    doorbell,
    calls,
    emit: (f: ServerMessage) => emit(f),
    error: (f: ServerMessage) => error(f),
  };
}

describe('attachVersionDoorbell', () => {
  test('a room doorbell signals its change version', () => {
    const topic = buildRoomTopic(roomId);
    const room = harness(topic, 'room.changed', roomId);
    room.emit(
      event(topic, { kind: 'room.changed', entityVersion: 7, ids: [roomId] }),
    );
    room.emit(
      event(buildRoomTopic('z'.repeat(24)), {
        kind: 'room.changed',
        entityVersion: 9,
        ids: ['z'.repeat(24)],
      }),
    );
    assert({
      given: 'a doorbell for this room and one for another room',
      should: 'subscribe to this room and signal only its change version',
      actual: room.calls,
      expected: [topic, 7],
    });
  });

  test('a round doorbell signals its round version', () => {
    const topic = buildDebateTopic(roundId);
    const round = harness(topic, 'debate.phase-changed', roundId);
    round.emit(
      event(topic, {
        kind: 'debate.phase-changed',
        entityVersion: 4,
        ids: [roundId],
      }),
    );
    round.emit(
      event(topic, {
        kind: 'debate.phase-changed',
        entityVersion: 5,
        ids: ['z'.repeat(24)],
      }),
    );
    assert({
      given: 'a phase change naming this round, then one naming another',
      should: 'signal only the version for this round',
      actual: round.calls,
      expected: [topic, 4],
    });
  });

  test('resync and connection errors signal a version-less read', () => {
    const topic = buildRoomTopic(roomId);
    const room = harness(topic, 'room.changed', roomId);
    room.emit({
      v: ENVELOPE_VERSION,
      type: 'resync_required',
      id: 's1',
      topic,
    });
    room.error({
      v: ENVELOPE_VERSION,
      type: 'error',
      code: 'INFRASTRUCTURE',
      message: 'Realtime unavailable',
    });
    room.doorbell.authorizedSnapshot();
    room.doorbell.close();
    assert({
      given: 'a resync, a connection error, an authorized read, then closing',
      should:
        'signal twice without a version, resubscribe after the read and release both listeners',
      actual: room.calls,
      expected: [
        topic,
        null,
        null,
        `retry:${topic}`,
        'unsubscribe',
        'stop errors',
      ],
    });
  });
});
