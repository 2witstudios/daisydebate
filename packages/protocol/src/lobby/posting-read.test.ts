import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { z } from 'zod';
import { parseOutcome } from '../parse-outcome.test-support';
import { postingReadCatalogue, postingViewSchema } from './posting-read';

setupRitewayBun();

const verdict = (schema: z.ZodType, input: unknown) => {
  const parsed = parseOutcome(schema, input);
  return 'data' in parsed ? 'accepted' : parsed.issues;
};

const id = (c: string) => c.repeat(24);
const fixture = {
  fixtureId: id('f'),
  kind: 'pairing',
  room: { roomId: id('m'), name: 'Room 3' },
  entries: [
    { entryId: id('a'), shown: { kind: 'name', name: 'Okafor' } },
    { entryId: id('b'), shown: { kind: 'name', name: 'Wu' } },
  ],
  judges: [{ name: 'T. Abara', chair: false }],
  video: true,
};
const posting = {
  lobbyId: id('l'),
  event: { eventId: id('e'), name: 'Varsity debate' },
  tabRound: {
    tabRoundId: id('r'),
    eventId: id('e'),
    number: 4,
    name: null,
    stage: 'preliminary',
  },
  opensAt: '2026-11-14T15:20:00.000Z',
  startedAt: null,
  roomCount: 12,
  fixtures: [fixture],
  more: 0,
  resolution: null,
};

describe('the posting (TAB-5.14)', async () => {
  test('a variant for each audience that sees less', async () => {
    assert({
      given:
        "a participant's posting, the public's with an entrant by initials and no video, and one whose resolution is released",
      should: 'accept each',
      actual: [
        verdict(postingViewSchema, posting),
        verdict(postingViewSchema, {
          ...posting,
          fixtures: [
            {
              ...fixture,
              entries: [
                {
                  entryId: id('a'),
                  shown: { kind: 'initials', initials: 'C. O.' },
                },
                fixture.entries[1],
              ],
              video: false,
            },
          ],
        }),
        verdict(postingViewSchema, {
          ...posting,
          resolution: { text: 'This house would ban cars from city centres.' },
        }),
      ],
      expected: ['accepted', 'accepted', 'accepted'],
    });
  });

  test('refusals', async () => {
    assert({
      given:
        'initials that are a name, an entrant shown both ways, a draft status on a fixture, and an unknown key',
      should: 'refuse each',
      actual: [
        verdict(postingViewSchema, {
          ...posting,
          fixtures: [
            {
              ...fixture,
              entries: [
                {
                  entryId: id('a'),
                  shown: { kind: 'initials', initials: 'Chidi' },
                },
              ],
            },
          ],
        }),
        verdict(postingViewSchema, {
          ...posting,
          fixtures: [
            {
              ...fixture,
              entries: [
                {
                  entryId: id('a'),
                  shown: { kind: 'name', name: 'Okafor', initials: 'C. O.' },
                },
              ],
            },
          ],
        }),
        verdict(postingViewSchema, {
          ...posting,
          fixtures: [{ ...fixture, status: 'draft' }],
        }),
        verdict(postingViewSchema, { ...posting, href: '/rooms/1' }),
      ],
      expected: [
        ['fixtures.0.entries.0.shown.initials'],
        ['fixtures.0.entries.0.shown'],
        ['fixtures.0'],
        ['(root)'],
      ],
    });
  });

  test('gate', async () => {
    assert({
      given: 'the posting read',
      should: 'answer under posting.read',
      actual: postingReadCatalogue,
      expected: { PostingView: { gate: ['posting.read'] } },
    });
  });
});
