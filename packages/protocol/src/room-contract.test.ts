import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roomCommandSchema } from './room-contract';

setupRitewayBun();
const commandId = 'abcdefghijklmnopqrstuvwx';

describe('Room command boundary', () => {
  test('requires version and refuses caller identity claims', () => {
    const valid = {
      commandId,
      expectedVersion: 3,
      expectedConsentVersion: 0,
      type: 'ready',
    };
    const cases = [
      valid,
      { ...valid, expectedVersion: undefined },
      { ...valid, actorId: commandId },
      { ...valid, expectedVersion: 0 },
    ];
    assert({
      given: 'valid, unversioned, claimed-actor and zero-version readiness',
      should: 'accept only the principal-bound versioned command',
      actual: cases.map((value) => roomCommandSchema.safeParse(value).success),
      expected: [true, false, false, false],
    });
  });
  test('requires an explicit actor and legal seat for host casting', () => {
    const base = {
      commandId,
      expectedVersion: 1,
      type: 'assign-seat',
      actorId: commandId,
      role: 'judge',
      slot: 0,
    };
    assert({
      given: 'host casting and malformed seats',
      should: 'validate identity, role and nonnegative integer slot',
      actual: [
        base,
        { ...base, actorId: 'fake' },
        { ...base, slot: -1 },
        { ...base, role: 'spectator' },
      ].map((value) => roomCommandSchema.safeParse(value).success),
      expected: [true, false, false, false],
    });
  });
});
