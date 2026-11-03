import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomAssemblyState, RoomCapture } from '@daisy/protocol';
import { executeRoomCommand } from './room-assembly';
import { plannedBroadcast, plannedRecording } from './room-capture';
import { consent, edges, state } from './room-assembly.test-support';

setupRitewayBun();

const both: RoomCapture = {
  broadcast: {
    release: { kind: 'delay', seconds: 60 },
    debatersReadChat: true,
  },
  recording: true,
};
const nothing: RoomCapture = { broadcast: null, recording: false };
const set = (capture: RoomCapture, expectedVersion = 4) => ({
  commandId: 'c',
  expectedVersion,
  type: 'set-capture' as const,
  capture,
});
const entitled = { ...edges, hostHoldsCasualCapture: true };
const run = (
  room: RoomAssemblyState,
  capture: RoomCapture,
  actor = 'host',
  facts = entitled,
) => executeRoomCommand(room, actor, set(capture), consent, facts);

describe('The host capture choice', () => {
  test('without the entitlement the host can choose nothing', () => {
    const room = state();
    const before = JSON.stringify(room);
    assert({
      given: 'a casual host holding no grant',
      should: 'refuse the choice and leave the Room unchanged',
      actual: [
        run(room, both, 'host', { ...entitled, hostHoldsCasualCapture: false }),
        JSON.stringify(room),
      ],
      expected: [{ ok: false, refusal: 'capture-premium' }, before],
    });
  });

  test('only the host chooses', () => {
    assert({
      given: 'a seated debater who is not the host',
      should: 'refuse',
      actual: run(state(), both, 'other'),
      expected: { ok: false, refusal: 'host-required' },
    });
  });

  test('broadcast and recording are separate choices', () => {
    const recordingOnly = { broadcast: null, recording: true };
    const broadcastOnly = { ...both, recording: false };
    const stored = (capture: RoomCapture) => {
      const outcome = run(state(), capture);
      return outcome.ok ? outcome.mutation.state.capture : null;
    };
    assert({
      given: 'each choice alone and both together',
      should: 'store exactly what the host chose',
      actual: [stored(recordingOnly), stored(broadcastOnly), stored(both)],
      expected: [recordingOnly, broadcastOnly, both],
    });
  });

  test('choosing nothing clears the choice, and needs no entitlement', () => {
    const outcome = run({ ...state(), capture: both }, nothing, 'host', {
      ...entitled,
      hostHoldsCasualCapture: false,
    });
    assert({
      given: 'a host who lost the grant turning everything off',
      should: 'store no capture at all',
      actual: outcome.ok ? outcome.mutation.state.capture : 'refused',
      expected: null,
    });
  });

  test('a changed choice asks every seat to Ready again', () => {
    const outcome = run(state(), both);
    assert({
      given: 'two Ready seats and a new capture choice',
      should: 'bump the version and clear each Ready',
      actual: outcome.ok
        ? [
            outcome.mutation.state.version,
            outcome.mutation.state.participants.map((p) => p.consentCommandId),
          ]
        : 'refused',
      expected: [5, [null, null]],
    });
  });

  test('ranked capture is a fact, never a choice', () => {
    assert({
      given: 'a ranked host choosing capture',
      should: 'refuse',
      actual: run({ ...state(), competitionType: 'ranked' }, both),
      expected: { ok: false, refusal: 'illegal-config' },
    });
  });

  test('a private Room can record but not broadcast', () => {
    const room: RoomAssemblyState = { ...state(), visibility: 'private' };
    const recording = run(room, { broadcast: null, recording: true });
    assert({
      given: 'a private Room',
      should: 'refuse a Broadcast and accept a Recording',
      actual: [run(room, both), recording.ok],
      expected: [{ ok: false, refusal: 'broadcast-private' }, true],
    });
  });

  test('Launch refuses a private Room’s Broadcast, and keeps its Recording', () => {
    const start = {
      commandId: 'c',
      expectedVersion: 4,
      type: 'start-round' as const,
    };
    const launch = (capture: typeof both) =>
      executeRoomCommand(
        { ...state(), visibility: 'private' as const, capture },
        'host',
        start,
        consent,
        entitled,
      );
    assert({
      given: 'a private Room holding a Broadcast choice, however it got there',
      should: 'refuse at Launch, and a Recording alone still starts',
      actual: [launch(both), launch({ broadcast: null, recording: true }).ok],
      expected: [{ ok: false, refusal: 'broadcast-private' }, true],
    });
  });

  test('Launch refuses a choice the host can no longer make', () => {
    const start = {
      commandId: 'c',
      expectedVersion: 4,
      type: 'start-round' as const,
    };
    const room = { ...state(), capture: both };
    assert({
      given: 'a stored choice whose host lost the grant',
      should: 'refuse rather than capture without the entitlement',
      actual: executeRoomCommand(room, 'host', start, consent, {
        ...entitled,
        hostHoldsCasualCapture: false,
      }),
      expected: { ok: false, refusal: 'capture-premium' },
    });
  });
});

describe('What a Round captures', () => {
  test('a Broadcast follows the host, except on ranked', () => {
    const ranked = { ...state(), competitionType: 'ranked' as const };
    assert({
      given: 'no choice, a casual choice, and a ranked Room',
      should: 'plan none, the choice, and the fixed ranked Broadcast',
      actual: [
        plannedBroadcast(state()),
        plannedBroadcast({ ...state(), capture: both }),
        plannedBroadcast(ranked),
      ],
      expected: [
        null,
        {
          releasePolicy: { kind: 'delay', seconds: 60 },
          debatersReadChat: true,
        },
        {
          releasePolicy: { kind: 'delay', seconds: 60 },
          debatersReadChat: false,
        },
      ],
    });
  });

  test('a Recording follows the host, except on ranked', () => {
    assert({
      given: 'no choice, a recording choice, and a ranked Room',
      should: 'plan a Recording on the last two only',
      actual: [
        plannedRecording(state()),
        plannedRecording({
          ...state(),
          capture: { broadcast: null, recording: true },
        }),
        plannedRecording({ ...state(), competitionType: 'ranked' }),
      ],
      expected: [false, true, true],
    });
  });
});
