import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { z } from 'zod';
import { parseOutcome } from '../parse-outcome.test-support';
import { dayReadCatalogue, dayViewSchema } from './day-read';

setupRitewayBun();

const verdict = (schema: z.ZodType, input: unknown) => {
  const parsed = parseOutcome(schema, input);
  return 'data' in parsed ? 'accepted' : parsed.issues;
};

const id = (c: string) => c.repeat(24);
const at = (time: string) => `2026-12-12T${time}:00.000Z`;
const round = (event: string, number: number) => ({
  tabRoundId: id(event === 'p' ? 'r' : 's'),
  eventId: id(event),
  number,
  name: null,
  stage: 'preliminary',
});
const fixture = {
  fixtureId: id('f'),
  kind: 'pairing',
  room: { roomId: id('m'), name: 'Room 7' },
  entries: [
    {
      entryId: id('g'),
      shown: { kind: 'name', name: 'Ridgeview C' },
      side: 'Government',
      own: false,
    },
    {
      entryId: id('h'),
      shown: { kind: 'name', name: 'Hartwell B' },
      side: 'Opposition',
      own: true,
    },
  ],
  judges: [{ name: 'S. Cho', chair: false }],
  speaks: null,
  topicAt: null,
};
const parli = {
  person: { kind: 'self' },
  role: 'competitor',
  event: { eventId: id('p'), name: 'Parli' },
  entry: { entryId: id('h'), name: 'Hartwell B', record: null },
  tabRound: round('p', 2),
  breaking: null,
  fixture,
  state: { kind: 'live', phase: 'preparing', speechesBeginAt: at('12:24') },
  result: null,
  recording: null,
};
const extemp = {
  ...parli,
  event: { eventId: id('x'), name: 'Extemp' },
  entry: { entryId: id('w'), name: 'Wu', record: null },
  tabRound: round('x', 1),
  fixture: {
    ...fixture,
    kind: 'section',
    entries: [{ ...fixture.entries[1], own: true }],
    speaks: { position: 2, of: 6 },
    topicAt: at('13:00'),
  },
  state: { kind: 'posted', opensAt: at('13:30') },
};
const slot = (time: string, rows: readonly unknown[]) => ({
  timeSlotId: id(time === '12:00' ? 'a' : 'b'),
  name: `Slot ${time}`,
  startsAt: at(time),
  rows,
});
const day = (slots: readonly unknown[]) => ({
  lobbyId: id('l'),
  asOf: at('12:10'),
  slots,
});

describe('a person’s day by time slot (TAB-5.14)', async () => {
  test('several events, a ward, and what is still to be drawn', async () => {
    assert({
      given:
        "a person entered in two events in two slots, a guardian's ward and their own judging in one slot, and a break not yet drawn",
      should: 'accept each day',
      actual: [
        verdict(
          dayViewSchema,
          day([slot('12:00', [parli]), slot('13:30', [extemp])]),
        ),
        verdict(
          dayViewSchema,
          day([
            slot('12:00', [
              {
                ...parli,
                person: { kind: 'ward', actorId: id('c'), name: 'Chidi' },
              },
              {
                ...parli,
                role: 'judge',
                entry: null,
                state: { kind: 'ballots_due' },
              },
            ]),
          ]),
        ),
        verdict(
          dayViewSchema,
          day([
            slot('12:00', [
              {
                ...parli,
                tabRound: { ...round('p', 4), stage: 'elimination' },
                breaking: { size: null, divisions: ['open', 'novice'] },
                fixture: null,
                state: { kind: 'not_posted' },
              },
            ]),
          ]),
        ),
      ],
      expected: ['accepted', 'accepted', 'accepted'],
    });
  });

  test('a result cut to what the viewer’s audiences may see', async () => {
    const over = (result: unknown) =>
      verdict(
        dayViewSchema,
        day([slot('12:00', [{ ...parli, state: { kind: 'over' }, result }])]),
      );
    assert({
      given:
        'a result withheld until prelims end, a decision without scores, a decision with scores, and a rank in a section',
      should: 'accept each variant',
      actual: [
        over({ kind: 'withheld', opensAt: 'prelims_end' }),
        over({
          kind: 'released',
          decision: {
            kind: 'debate',
            won: true,
            judgesFor: 1,
            judgesAgainst: 0,
          },
          scores: null,
        }),
        over({
          kind: 'released',
          decision: {
            kind: 'debate',
            won: false,
            judgesFor: 0,
            judgesAgainst: 1,
          },
          scores: { points: 27.5 },
        }),
        over({
          kind: 'released',
          decision: { kind: 'ranked', rank: 2, of: 6 },
          scores: null,
        }),
      ],
      expected: ['accepted', 'accepted', 'accepted', 'accepted'],
    });
    assert({
      given:
        'a withheld result naming a cause outside the vocabulary, and a released one with feedback text',
      should: 'refuse each',
      actual: [
        over({ kind: 'withheld', opensAt: 'tomorrow' }),
        over({
          kind: 'released',
          decision: { kind: 'ranked', rank: 2, of: 6 },
          scores: null,
          feedback: 'Strong rebuttal.',
        }),
      ],
      expected: [['slots.0.rows.0.result.opensAt'], ['slots.0.rows.0.result']],
    });
  });

  test('strictness and gate', async () => {
    assert({
      given: 'a slot with no rows, and a row with an unknown key',
      should: 'refuse each',
      actual: [
        verdict(dayViewSchema, day([slot('12:00', [])])),
        verdict(
          dayViewSchema,
          day([slot('12:00', [{ ...parli, href: '/rooms/7' }])]),
        ),
      ],
      expected: [['slots.0.rows'], ['slots.0.rows.0']],
    });
    assert({
      given: 'the day read',
      should: 'answer under lobby.read',
      actual: dayReadCatalogue,
      expected: { DayView: { gate: ['lobby.read'] } },
    });
  });
});
