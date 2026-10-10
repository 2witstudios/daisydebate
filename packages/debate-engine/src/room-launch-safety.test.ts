import { assert, setupRitewayBun, test } from 'riteway/bun';
import { MAX_FORMAT_SEATS, type RoundRules } from '@daisy/protocol';
import { executeRoomCommand } from './room-assembly';
import { consent, edges, state } from './room-assembly.test-support';

setupRitewayBun();

test('direct Launch refuses unsafe rules without freezing or changing state', () => {
  const source = state();
  const variants = [
    null as unknown as RoundRules,
    { ...source.rules, seats: { affirmative: 1, judge: 0 } } as RoundRules,
    {
      ...source.rules,
      seats: { affirmative: 1, negative: 0, judge: 0 },
      segments: source.rules.segments.filter((s) => s.side === 'affirmative'),
    },
    {
      ...source.rules,
      segments: source.rules.segments.filter((s) => s.side === 'affirmative'),
    },
    {
      ...source.rules,
      seats: { affirmative: 0, negative: 1, judge: 0 },
      segments: source.rules.segments.filter((s) => s.side === 'negative'),
    },
    {
      ...source.rules,
      segments: source.rules.segments.filter((s) => s.side === 'negative'),
    },
    ...(['affirmative', 'negative', 'judge'] as const).map((role) => ({
      ...source.rules,
      seats: { ...source.rules.seats, [role]: 1_000_000_000 },
    })),
    { ...source.rules, seats: { affirmative: 128, negative: 128, judge: 1 } },
    {
      ...source.rules,
      segments: source.rules.segments.map((s) => ({ ...s, slot: 99 })),
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
          rules?.seats.negative === 0
            ? source.participants.filter((p) => p.role === 'affirmative')
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
      seats: { ...source.definition.seats, judge: MAX_FORMAT_SEATS },
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
