import { assert, setupRitewayBun, test } from 'riteway/bun';
import { capabilityOf } from './authority';

setupRitewayBun();

const envelope = { commandId: 'c'.repeat(24), expectedVersion: 1 };

test('a strike is a seated action, never host management', () => {
  assert({
    given: 'a strike, a seat claim, readiness and a host command',
    should: 'ask for the seated strike capability, not room.manage',
    actual: [
      capabilityOf({
        ...envelope,
        type: 'strike-resolution',
        ordinal: 0,
        position: 1,
      }),
      capabilityOf({
        ...envelope,
        type: 'claim-seat',
        role: 'negative',
        slot: 0,
      }),
      capabilityOf({ ...envelope, type: 'ready', expectedConsentVersion: 0 }),
      capabilityOf({ ...envelope, type: 'start-pre-round' }),
    ],
    expected: ['room.strike', 'room.join', 'room.ready', 'room.manage'],
  });
});
