import { assert, setupRitewayBun, test } from 'riteway/bun';
import { MAX_FORMAT_SEATS, sideOfSeat, type RoundRules } from '@daisy/protocol';
import { executeRoomCommand } from './room-assembly';
import { consent, edges, state } from './room-assembly.test-support';

setupRitewayBun();

test('direct Launch refuses unsafe rules without freezing or changing state', () => {
  const source = state();
  const speaksFor =
    (side: string) => (s: (typeof source.rules.segments)[number]) =>
      s.speak.rights === 'one' && sideOfSeat(s.speak.seat) === side;
  const seats = (
    sides: Record<string, number>,
    judges = 0,
  ): RoundRules['seats'] => ({ sides, speakers: 0, judges, moderators: 0 });
  const variants = [
    null as unknown as RoundRules,
    { ...source.rules, seats: seats({ affirmative: 1 }) } as RoundRules,
    {
      ...source.rules,
      seats: seats({ affirmative: 1, negative: 0 }),
      segments: source.rules.segments.filter(speaksFor('affirmative')),
    },
    {
      ...source.rules,
      segments: source.rules.segments.filter(speaksFor('affirmative')),
    },
    {
      ...source.rules,
      seats: seats({ affirmative: 0, negative: 1 }),
      segments: source.rules.segments.filter(speaksFor('negative')),
    },
    {
      ...source.rules,
      segments: source.rules.segments.filter(speaksFor('negative')),
    },
    ...(['affirmative', 'negative'] as const).map((side) => ({
      ...source.rules,
      seats: seats({ ...source.rules.seats.sides, [side]: 1_000_000_000 }),
    })),
    {
      ...source.rules,
      seats: seats(source.rules.seats.sides, 1_000_000_000),
    },
    {
      ...source.rules,
      seats: seats({ affirmative: 128, negative: 128 }, 1),
    },
    {
      ...source.rules,
      segments: source.rules.segments.map((s) =>
        s.speak.rights === 'one' && s.speak.seat.kind === 'side'
          ? {
              ...s,
              speak: { ...s.speak, seat: { ...s.speak.seat, slot: 99 } },
            }
          : s,
      ),
    },
  ];
  assert({
    given: 'direct domain callers bypassing portable parsing',
    should:
      'refuse unsafe Launch with no freeze and preserve the original Room',
    actual: variants.map((rules) => {
      const room = {
        ...source,
        rules,
        participants:
          rules?.seats.sides.negative === 0
            ? source.participants.filter(
                (p) => sideOfSeat(p.seat) === 'affirmative',
              )
            : source.participants,
      };
      const before = JSON.stringify(room);
      return [
        executeRoomCommand(
          room,
          'host',
          {
            type: 'start-round',
            commandId: 'unsafe-launch',
            expectedVersion: room.version,
          },
          consent,
          edges,
        ),
        JSON.stringify(room) === before,
      ];
    }),
    expected: variants.map(() => [
      { ok: false, refusal: 'illegal-config' } as const,
      true,
    ]),
  });
});

test('direct Launch refuses an unsafe definition even alongside valid rules', () => {
  const source = state();
  const room = {
    ...source,
    definition: {
      ...source.definition,
      seats: { ...source.definition.seats, judges: MAX_FORMAT_SEATS },
    },
  };
  assert({
    given:
      'a caller bypasses admission with a dangerous definition and valid rules',
    should: 'refuse before freeze',
    actual: executeRoomCommand(
      room,
      'host',
      {
        type: 'start-round',
        commandId: 'unsafe-definition',
        expectedVersion: room.version,
      },
      consent,
      edges,
    ),
    expected: { ok: false, refusal: 'illegal-config' },
  });
});
