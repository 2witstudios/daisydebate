import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  oneOnOneFormatFixture,
  plainRoomConfig,
} from './format-fixtures.test-support';
import { roomCommandSchema, roomCreateSchema } from './room-contract';
import { roomCastChoiceSchema } from './room-read';

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
        resolution: { kind: 'custom', text: 'Topic' },
        visibility: 'public',
        selection,
      }).success;
    const catalog = (competitionType: string) => ({
      kind: 'catalog',
      formatId: 'value',
      formatVersion: 1,
      presetVersion: 1,
      competitionType,
    });
    const custom = (competitionType: string) => ({
      kind: 'custom',
      definition: oneOnOneFormatFixture,
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
  test('an initial cast seats AI actors once each (train-room)', () => {
    const create = (cast: unknown) =>
      roomCreateSchema.safeParse({
        commandId,
        title: 'Title',
        resolution: { kind: 'strike' },
        visibility: 'public',
        selection: {
          kind: 'catalog',
          formatId: 'freestyle',
          formatVersion: 1,
          presetVersion: 1,
          competitionType: 'casual',
        },
        cast,
      });
    const seat = (actorId: string, role: string, slot = 0) => ({
      actorId,
      role,
      slot,
    });
    const bot = 'w2r5e8n1b4o7t0a3n6i9c2e5';
    const judge = 'a1i2j3u4d5g6e7a8i9j0u1d2';
    assert({
      given: 'a create with no cast and one with distinct AI actors',
      should: 'accept both: the cast is optional',
      actual: [
        create(undefined).success,
        create([seat(bot, 'negative'), seat(judge, 'judge')]).success,
      ],
      expected: [true, true],
    });
    assert({
      given: 'a cast seating one actor twice',
      should: 'refuse: assign-seat would move, not reject, the repeat',
      actual: create([seat(bot, 'negative'), seat(bot, 'affirmative')]).success,
      expected: false,
    });
    assert({
      given: 'a cast entry with a non-seat role, a negative slot or a short id',
      should: 'refuse every malformed entry',
      actual: [
        create([seat(bot, 'host')]).success,
        create([seat(bot, 'negative', -1)]).success,
        create([seat('too-short', 'negative')]).success,
      ],
      expected: [false, false, false],
    });
    assert({
      given: 'a cast longer than any format declares seats',
      should: 'refuse the whole cast',
      actual: create(Array.from({ length: 9 }, (_, i) => seat(bot, 'judge', i)))
        .success,
      expected: false,
    });
  });
  test('a cast choice carries its roster display facts (train-room)', () => {
    const choice = (fields: Record<string, unknown>) =>
      roomCastChoiceSchema.safeParse({
        actorId: 'c6a4e2f8h1j3k5m7n9p2r4t6',
        label: 'Wren',
        kind: 'bot',
        seatRole: 'debater',
        eligible: true,
        ...fields,
      });
    assert({
      given:
        'a bot debater with persona and difficulty, the AI judge with neither, and a difficulty outside the vocabulary',
      should:
        'carry the display facts as optional and refuse an unknown difficulty',
      actual: [
        choice({ persona: 'Dry and quick', difficulty: 'intermediate' })
          .success,
        choice({}).success,
        choice({ difficulty: 'expert' }).success,
      ],
      expected: [true, true, false],
    });
  });
  test('a catalog selection names its preset and carries no config (FMT-1)', () => {
    const create = (selection: Record<string, unknown>) =>
      roomCreateSchema.safeParse({
        commandId,
        title: 'Title',
        resolution: { kind: 'custom', text: 'Topic' },
        visibility: 'public',
        selection,
      }).success;
    const base = {
      kind: 'catalog',
      formatId: 'value',
      formatVersion: 1,
      competitionType: 'casual',
    };
    assert({
      given:
        'a catalog selection with its preset, without one, and with a client-supplied config',
      should:
        'accept only the preset tuple: the config always comes from the canonical preset',
      actual: [
        create({ ...base, presetVersion: 1 }),
        create(base),
        create({ ...base, presetVersion: 1, config: plainRoomConfig }),
      ],
      expected: [true, false, false],
    });
  });
  test('refuses a length on every selection: Rounds are full length only (DEC-237)', () => {
    const create = (selection: Record<string, unknown>) =>
      roomCreateSchema.safeParse({
        commandId,
        title: 'Title',
        resolution: { kind: 'custom', text: 'Topic' },
        visibility: 'public',
        selection,
      }).success;
    const selections = [
      {
        kind: 'catalog',
        formatId: 'value',
        formatVersion: 1,
        presetVersion: 1,
        competitionType: 'casual',
      },
      {
        kind: 'ranked',
        formatId: 'one-on-one',
        formatVersion: 2,
        presetVersion: 2,
      },
      {
        kind: 'custom',
        definition: oneOnOneFormatFixture,
        competitionType: 'casual',
        config: plainRoomConfig,
      },
    ];
    assert({
      given:
        'catalog, ranked and custom selections with no length, full and quick',
      should: 'accept only the selection that names no length',
      actual: selections.map((selection) => [
        create(selection),
        create({ ...selection, length: 'full' }),
        create({ ...selection, length: 'quick' }),
      ]),
      expected: selections.map(() => [true, false, false]),
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
