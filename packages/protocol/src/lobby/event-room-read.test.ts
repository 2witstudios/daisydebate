import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { z } from 'zod';
import { parseOutcome } from '../parse-outcome.test-support';
import { eventRoomReadCatalogue, eventRoomViewSchema } from './event-room-read';

setupRitewayBun();

const verdict = (schema: z.ZodType, input: unknown) => {
  const parsed = parseOutcome(schema, input);
  return 'data' in parsed ? 'accepted' : parsed.issues;
};

const id = (c: string) => c.repeat(24);
const at = (time: string) => `2026-11-14T${time}:00.000Z`;
const entry = (name: string, side: string, own: boolean) => ({
  entryId: id(own ? 'y' : 'j'),
  name,
  side,
  seed: null,
  school: null,
  members: [],
  speaks: null,
  present: 1,
  of: 1,
  own,
});
const room = {
  roomId: id('m'),
  fixtureId: id('f'),
  lobby: { lobbyId: id('l'), handle: 'autumn-open', name: 'Autumn Open' },
  asOf: at('14:00'),
  event: { eventId: id('e'), name: 'Varsity debate' },
  tabRound: {
    tabRoundId: id('r'),
    eventId: id('e'),
    number: 4,
    name: null,
    stage: 'preliminary',
  },
  kind: 'pairing',
  roomName: 'Room 5',
  opensAt: at('15:20'),
  state: { kind: 'posted', opensAt: at('15:20') },
  entries: [
    entry('Sato', 'Affirmative', false),
    entry('Doyle', 'Negative', true),
  ],
  judges: [{ name: 'R. Keane', chair: false, present: true, own: false }],
  pinned: {
    source: { kind: 'lobby', id: id('l'), name: 'Autumn Open' },
    lines: [{ line: 'decision', text: 'One judge' }],
  },
  capabilities: { ballot: false },
};

describe('an event Room before its Round (TAB-5.14)', async () => {
  test('parsing', async () => {
    assert({
      given:
        "a competitor's Room, a judge's with the ballot open to them, and one whose values the catalogue set",
      should: 'accept each',
      actual: [
        verdict(eventRoomViewSchema, room),
        verdict(eventRoomViewSchema, {
          ...room,
          entries: room.entries.map((one) => ({ ...one, own: false })),
          judges: [{ ...room.judges[0], own: true }],
          capabilities: { ballot: true },
        }),
        verdict(eventRoomViewSchema, {
          ...room,
          pinned: { ...room.pinned, source: { kind: 'catalogue' } },
        }),
      ],
      expected: ['accepted', 'accepted', 'accepted'],
    });
  });

  test('refusals', async () => {
    assert({
      given:
        'a bye, a pinned line outside the list, a Room with no entries, and an unknown key',
      should: 'refuse each',
      actual: [
        verdict(eventRoomViewSchema, { ...room, kind: 'bye' }),
        verdict(eventRoomViewSchema, {
          ...room,
          pinned: {
            ...room.pinned,
            lines: [{ line: 'tiebreaks', text: 'Wins' }],
          },
        }),
        verdict(eventRoomViewSchema, { ...room, entries: [] }),
        verdict(eventRoomViewSchema, { ...room, hostActorId: id('h') }),
      ],
      expected: [['kind'], ['pinned.lines.0.line'], ['entries'], ['(root)']],
    });
    assert({
      given: 'the event Room read',
      should: 'answer under room.read',
      actual: eventRoomReadCatalogue,
      expected: { EventRoomView: { gate: ['room.read'] } },
    });
  });
});
