import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  oneOnOneFormatFixture,
  plainRoomConfig,
} from './format-fixtures.test-support';
import { roomCommandSchema, roomCreateSchema } from './room-contract';

setupRitewayBun();
const commandId = 'abcdefghijklmnopqrstuvwx';

describe('Room command boundary', () => {
  test('refuses private visibility from every request (DEC-206)', () => {
    const details = (visibility: string) => ({
      commandId,
      expectedVersion: 3,
      type: 'update-details',
      title: 'Title',
      topic: 'Topic',
      visibility,
    });
    const create = (visibility: string) =>
      roomCreateSchema.shape.visibility.safeParse(visibility).success;
    assert({
      given: 'create and update-details requests naming each visibility',
      should: 'accept public and unlisted and refuse private in both',
      actual: ['public', 'unlisted', 'private'].map((visibility) => [
        create(visibility),
        roomCommandSchema.safeParse(details(visibility)).success,
      ]),
      expected: [
        [true, true],
        [true, true],
        [false, false],
      ],
    });
  });
  test('creates an unranked Room only as casual (DEC-233)', () => {
    const create = (selection: Record<string, unknown>) =>
      roomCreateSchema.safeParse({
        commandId,
        title: 'Title',
        topic: 'Topic',
        visibility: 'public',
        selection,
      }).success;
    const catalog = (competitionType: string) => ({
      kind: 'catalog',
      formatId: 'one-on-one',
      formatVersion: 1,
      length: 'full',
      competitionType,
      config: plainRoomConfig,
    });
    const custom = (competitionType: string) => ({
      kind: 'custom',
      definition: oneOnOneFormatFixture,
      length: 'full',
      competitionType,
      config: plainRoomConfig,
    });
    assert({
      given: 'catalog and custom selections naming casual, practice and ranked',
      should: 'accept only casual, so no practice Room can be created',
      actual: ['casual', 'practice', 'ranked'].map((type) => [
        create(catalog(type)),
        create(custom(type)),
      ]),
      expected: [
        [true, true],
        [false, false],
        [false, false],
      ],
    });
  });
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
