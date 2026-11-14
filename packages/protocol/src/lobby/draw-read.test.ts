import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { authorizationCapabilitySchema } from '../authorization';
import { parseEach, parseOutcome, parsedUnchanged } from '../parse-outcome.test-support';
import {
  drawReadCatalogue,
  drawViewSchema,
  supersededInputListSchema,
} from './draw-read';

setupRitewayBun();

const id = (seed: string) => seed.padEnd(24, 'x');
const at = '2026-10-17T15:20:00.000Z';

const fixture = {
  fixtureId: id('fixturedoylesato'),
  kind: 'pairing',
  status: 'draft',
  entries: [
    { entryId: id('entrydoyle'), name: 'Doyle', side: 'negative' },
    { entryId: id('entrysato'), name: 'Sato', side: 'affirmative' },
  ],
  judges: [{ tournamentJudgeId: id('judgekeane'), name: 'R. Keane', chair: true }],
  findings: [{ severity: 'preference_bent', text: 'same school, preference bent' }],
  reasons: ['Both have 2 wins and have not met.'],
  alternative: {
    change: 'If you split them',
    cost: 'Sato would meet Petrov again.',
    breaksRule: 'No rematch',
  },
};

const bye = {
  ...fixture,
  fixtureId: id('fixtureellis'),
  kind: 'bye',
  entries: [{ entryId: id('entryellis'), name: 'Ellis', side: null }],
  judges: [],
  findings: [],
  alternative: null,
};

const drawView = {
  lobbyId: id('lobby'),
  eventId: id('event'),
  tabRound: { tabRoundId: id('tabround4'), number: 4 },
  draw: {
    drawId: id('draw4v3'),
    version: 3,
    status: 'draft',
    method: 'computed',
    publishedAt: null,
    basedOn: { drawId: id('draw4v2'), version: 2 },
  },
  sides: ['affirmative', 'negative'],
  resultsThroughRound: 3,
  recordGroups: [
    { wins: 2, fixtures: [fixture] },
    { wins: 1, fixtures: [bye] },
  ],
  spareJudges: [{ tournamentJudgeId: id('judgeshah'), name: 'A. Shah' }],
  capabilities: { edit: true, publish: false },
};

const item = {
  draw: {
    drawId: id('draw3v1'),
    tabRoundId: id('tabround3'),
    tabRoundNumber: 3,
    version: 1,
    publishedAt: at,
  },
  result: {
    resultId: id('resultold'),
    fixtureId: id('fixturereidnakata'),
    tabRoundNumber: 2,
    recordedAt: at,
  },
  correction: {
    resultId: id('resultnew'),
    supersedesResultId: id('resultold'),
    reason: 'The ballot was entered for the wrong side.',
    recordedAt: at,
  },
};
const supersededList = { lobbyId: id('lobby'), eventId: id('event'), items: [item] };

describe('the draw reads', () => {
  test('a draft draw version with its fixtures, findings and the engine’s reasons', () => {
    assert({
      given: 'a draft with a pairing, a bye, a first draft and a published one',
      should: 'parse each as it is',
      actual: parseEach(drawViewSchema, [
        drawView,
        { ...drawView, draw: { ...drawView.draw, version: 1, basedOn: null }, resultsThroughRound: null },
        {
          ...drawView,
          draw: { ...drawView.draw, status: 'published', publishedAt: at },
        },
      ]),
      expected: parsedUnchanged([
        drawView,
        { ...drawView, draw: { ...drawView.draw, version: 1, basedOn: null }, resultsThroughRound: null },
        {
          ...drawView,
          draw: { ...drawView.draw, status: 'published', publishedAt: at },
        },
      ]),
    });
  });

  test('what a draw read refuses', () => {
    assert({
      given:
        'an address, a severity outside the list, a fixture with no entries and a recompute control',
      should: 'refuse each at the field',
      actual: parseEach(drawViewSchema, [
        { ...drawView, href: '/host/somewhere' },
        {
          ...drawView,
          recordGroups: [
            { wins: 2, fixtures: [{ ...fixture, findings: [{ severity: 'relaxed', text: 'x' }] }] },
          ],
        },
        { ...drawView, recordGroups: [{ wins: 2, fixtures: [{ ...fixture, entries: [] }] }] },
        { ...drawView, capabilities: { ...drawView.capabilities, recompute: true } },
      ]),
      expected: [
        { issues: ['(root)'] },
        { issues: ['recordGroups.0.fixtures.0.findings.0.severity'] },
        { issues: ['recordGroups.0.fixtures.0.entries'] },
        { issues: ['capabilities'] },
      ],
    });
  });

  test('the published draws that used a result since superseded', () => {
    assert({
      given: 'a draw that used a result a correction superseded, and an empty list',
      should: 'parse each as it is',
      actual: parseEach(supersededInputListSchema, [
        supersededList,
        { ...supersededList, items: [] },
      ]),
      expected: parsedUnchanged([supersededList, { ...supersededList, items: [] }]),
    });
  });

  test('a superseded-input list offers nothing and names the right correction', () => {
    assert({
      given:
        'an item offering to recompute, and a correction that supersedes another result',
      should: 'refuse both',
      actual: parseEach(supersededInputListSchema, [
        { ...supersededList, items: [{ ...item, recompute: true }] },
        {
          ...supersededList,
          items: [
            {
              ...item,
              correction: { ...item.correction, supersedesResultId: id('resultother') },
            },
          ],
        },
      ]),
      expected: [{ issues: ['items.0'] }, { issues: ['items'] }],
    });
  });

  test('every draw read answers under the host read gate', () => {
    assert({
      given: 'the draw read catalogue',
      should: 'name lobby.host.read, a real capability, for each read',
      actual: Object.values(drawReadCatalogue).map((read) =>
        read.gate.map((gate) => parseOutcome(authorizationCapabilitySchema, gate)),
      ),
      expected: [[{ data: 'lobby.host.read' }], [{ data: 'lobby.host.read' }]],
    });
  });
});
