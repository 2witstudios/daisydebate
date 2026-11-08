import { assert, setupRitewayBun, test } from 'riteway/bun';

import {
  practiceAnswer,
  preparePractice,
  type PracticeCatalog,
} from './start-practice';
import { debater, judge } from './roster.test-support';
import { unequalTemplate } from '../rooms/assembly.test-support';

setupRitewayBun();

/** A standard catalog choice as the practice catalog reads it. */
const format = (formatId: string, label = formatId) => ({
  ...unequalTemplate,
  formatId,
  label,
  role: 'standard' as const,
});

const policyPublication = {
  id: 'p'.repeat(24),
  kind: 'policy' as const,
  text: 'Resolved: the standard is worth it',
  provenance: 'Daisy Beta Season 1',
  publishedAt: '2026-09-01T00:00:00.000Z',
  edition: null,
  theme: null,
};

const catalog: PracticeCatalog = {
  bots: [debater('wren-actor-id-000000', { label: 'Wren' }), judge()],
  botDebateAiJudge: true,
  formats: [format('freestyle', 'Freestyle'), format('policy', 'Policy')],
  resolutions: [policyPublication],
};

const form = (bot: string, extra: Record<string, string> = {}) => {
  const data = new FormData();
  data.set('bot', bot);
  for (const [name, value] of Object.entries(extra)) data.set(name, value);
  return data;
};

test('Start practice asks for a casual Freestyle Room with the chosen bot and the AI judge (DEC-269)', () => {
  const ready = preparePractice(
    form('wren-actor-id-000000'),
    catalog,
    'command-1',
  );
  assert({
    given: 'a chosen eligible opponent with the judge and format available',
    should:
      'build the create body: strike resolution, public, freestyle at its canonical preset, the bot at negative and the judge judging',
    actual:
      ready.kind === 'ready'
        ? [
            ready.body.title,
            ready.body.resolution,
            ready.body.visibility,
            ready.body.selection,
            ready.body.cast,
          ]
        : ready,
    expected: [
      'Practice vs Wren',
      { kind: 'strike' },
      'public',
      {
        kind: 'catalog',
        formatId: 'freestyle',
        formatVersion: unequalTemplate.formatVersion,
        presetVersion: unequalTemplate.preset.version,
        competitionType: 'casual',
      },
      [
        { actorId: 'wren-actor-id-000000', role: 'negative', slot: 0 },
        { actorId: 'judge-actor-id-000000', role: 'judge', slot: 0 },
      ],
    ],
  });
});

test('Start practice names the published resolution the addressed format debates', () => {
  const ready = preparePractice(
    form('wren-actor-id-000000', { format: 'policy' }),
    catalog,
    'command-1',
  );
  assert({
    given: 'a Policy practice with its publication present',
    should: 'select Policy at its canonical preset against the publication',
    actual:
      ready.kind === 'ready'
        ? [ready.body.resolution, ready.body.selection]
        : ready,
    expected: [
      { kind: 'policy', id: policyPublication.id },
      {
        kind: 'catalog',
        formatId: 'policy',
        formatVersion: unequalTemplate.formatVersion,
        presetVersion: unequalTemplate.preset.version,
        competitionType: 'casual',
      },
    ],
  });
});

test('Start practice refuses truthfully before any request', () => {
  const refusalOf = (
    bots: PracticeCatalog['bots'],
    bot: string,
    overrides: Partial<PracticeCatalog> = {},
    extra: Record<string, string> = {},
  ) =>
    preparePractice(
      form(bot, extra),
      { ...catalog, bots, ...overrides },
      'command-1',
    );
  assert({
    given:
      'an unknown opponent, an ineligible roster, a missing judge, a missing format, an unknown format and an unpublished format',
    should: 'refuse each with its own truthful message',
    actual: [
      refusalOf(catalog.bots, 'nobody').kind,
      refusalOf(
        [debater('wren-actor-id-000000', { eligible: false }), judge()],
        'wren-actor-id-000000',
      ).kind,
      refusalOf([debater('wren-actor-id-000000')], 'wren-actor-id-000000').kind,
      refusalOf(catalog.bots, 'wren-actor-id-000000', { formats: [] }).kind,
      refusalOf(catalog.bots, 'wren-actor-id-000000', {}, { format: 'parli' })
        .kind,
      refusalOf(
        catalog.bots,
        'wren-actor-id-000000',
        { resolutions: [] },
        { format: 'policy' },
      ).kind,
    ],
    expected: [
      'refused',
      'refused',
      'refused',
      'refused',
      'refused',
      'refused',
    ],
  });
});

test('Start practice without the casual AI judge leaves the judge seat for a person (WATCH-16)', () => {
  const ready = preparePractice(
    form('wren-actor-id-000000'),
    { ...catalog, botDebateAiJudge: false },
    'command-1',
  );
  assert({
    given: 'a member without the entitlement',
    should: 'seat only the bot, so the host invites a person to judge',
    actual: ready.kind === 'ready' ? ready.body.cast : ready,
    expected: [{ actorId: 'wren-actor-id-000000', role: 'negative', slot: 0 }],
  });
  const noJudge = preparePractice(
    form('wren-actor-id-000000'),
    {
      ...catalog,
      botDebateAiJudge: false,
      bots: [debater('wren-actor-id-000000', { label: 'Wren' })],
    },
    'command-1',
  );
  assert({
    given: 'a member without the entitlement and no AI judge on the roster',
    should: 'still build the practice',
    actual: noJudge.kind,
    expected: 'ready',
  });
});

const refusedLine = async (status: number, body?: object) => {
  const answer = await practiceAnswer(
    new Response(body ? JSON.stringify(body) : null, { status }),
    form('wren-actor-id-000000'),
  );
  return answer.error;
};

test('a Start practice refusal says its own reason (ISSUE-1011)', async () => {
  assert({
    given: 'a 403 and a 429, which carry no room refusal',
    should: 'show their own lines',
    actual: [await refusedLine(403), await refusedLine(429)],
    expected: [
      'Your account can’t start rooms right now.',
      'You’re starting rooms too quickly. Wait a moment.',
    ],
  });
  assert({
    given: 'a 409 naming the opponent, the seat, or a replay',
    should: 'show what to do next',
    actual: [
      await refusedLine(409, { refusal: 'actor-ineligible' }),
      await refusedLine(409, { refusal: 'seat-unavailable' }),
      await refusedLine(409, { refusal: 'command-conflict' }),
    ],
    expected: [
      'That opponent can’t start a practice right now. Pick another.',
      'Someone took that seat first. Start again.',
      'This form was already sent. Reload the page and try again.',
    ],
  });
  assert({
    given: 'a 500, and an inert route answering 404',
    should: 'say practice is unavailable',
    actual: [await refusedLine(500), await refusedLine(404)],
    expected: [
      'Practice is unavailable. Try again.',
      'Practice is unavailable. Try again.',
    ],
  });
});

test('Start practice moves on only on the answer every Room form reads', async () => {
  const answered = (status: number, body: object) =>
    practiceAnswer(
      new Response(JSON.stringify(body), { status }),
      form('wren-actor-id-000000'),
    );
  assert({
    given: 'a member who already holds a Room',
    should: 'take them back to it, or to the lobby with no link',
    actual: [
      (
        await answered(409, {
          refusal: 'active-room',
          activeRoom: {
            version: 1,
            id: 'r'.repeat(24),
            title: 'Open room',
            phase: 'assembling',
            role: 'host',
            seated: true,
            href: `/rooms/${'r'.repeat(24)}`,
          },
        })
      ).next,
      (await answered(409, { refusal: 'active-room', activeRoom: null })).next,
    ],
    expected: [`/rooms/${'r'.repeat(24)}`, '/lobby'],
  });
  assert({
    given: 'a 201 whose body is only a receipt, not the Room it created',
    should: 'not move on',
    actual: (await answered(201, { receipt: { roomId: 'r'.repeat(24) } })).next,
    expected: undefined,
  });
});
