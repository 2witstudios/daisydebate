import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomView } from '@daisy/protocol';
import { canOfferFreshRoom } from '../room-runtime/fresh-room';
import { roundEntry } from './round-entry';
import { assemblySnapshot } from './assembly.test-support';
import type { RoomCommandIds } from './room-command-ids';
import { roomSync, seedRoomSync } from './room-sync';

setupRitewayBun();

const ids = (tag: string): RoomCommandIds => ({
  header: { details: `${tag}d`, leave: `${tag}l`, close: `${tag}c` },
  readiness: { ready: `${tag}r`, unready: `${tag}u`, 'start-round': `${tag}s` },
  settings: `${tag}x`,
  capture: `${tag}cp`,
  seats: [],
  format: { choose: `${tag}fc`, reset: `${tag}fr`, template: `${tag}ft` },
});
const view = (
  changeVersion: number,
  patch: Partial<RoomView> = {},
): RoomView => ({
  ...assemblySnapshot,
  version: changeVersion,
  changeVersion,
  ...patch,
});
const seeded = seedRoomSync(view(3), ids('a'), 1000);
const read = (
  changeVersion: number,
  tag: string,
  patch: Partial<RoomView> = {},
) =>
  roomSync(roomSync(seeded, { type: 'read' }), {
    type: 'found',
    value: { view: view(changeVersion, patch), ids: ids(tag) },
    at: 9000,
  });

describe('room sync', () => {
  test('command identifiers rotate only when the room changes', () => {
    assert({
      given: 'a read of a newer change, and a read of the change already held',
      should:
        'offer the new identifiers for the newer change and keep them for the same one',
      actual: [
        read(4, 'b').value.ids.settings,
        read(3, 'b').value.ids.settings,
      ],
      expected: ['bx', 'ax'],
    });
  });
});

test('terminal entry remains closed across stale or nonmonotonic Room sync reads', () => {
  const participants = [
    {
      id: 'seat',
      actorId: 'member',
      label: 'Member',
      kind: 'human',
      role: 'negative',
      slot: 0,
      consentVersion: 1,
      needsReady: true,
      ready: 'ready',
      eligible: true,
    },
  ] as const;
  for (const status of ['completed', 'abandoned'] as const) {
    const held = seedRoomSync(
      view(5, {
        participants,
        roundRef: { id: 'round', status },
        status: 'started',
        hostActorId: 'member',
      }),
      ids('a'),
      0,
    );
    const terminal = roundEntry(held.value.view, 'member', null).terminal;
    for (const changeVersion of [4, 5, 6]) {
      const next = roomSync(held, {
        type: 'accepted',
        value: {
          view: view(changeVersion, {
            participants,
            roundRef: { id: 'round', status: 'active' },
            status: 'started',
            hostActorId: 'member',
          }),
          ids: ids('b'),
        },
        at: 1,
      });
      const entry = roundEntry(next.value.view, 'member', terminal);
      assert({
        given: `${status} observed before an active snapshot at Room version ${changeVersion}`,
        should: 'never re-trigger automatic entry after a terminal observation',
        actual: [
          entry.href,
          canOfferFreshRoom(
            { ...next.value.view, roundRef: entry.roundRef },
            'member',
          ),
        ],
        expected: [null, true],
      });
    }
  }
});
