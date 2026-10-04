import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleDraft } from '../../ui/mock/tournament-organizer';
import {
  parseWizardQuery,
  reviewFacts,
  sizesFor,
  wizardHref,
  wizardMarks,
  withStructure,
  wizardSummary,
  type WizardQuery,
} from './create-wizard';

setupRitewayBun();

const base: WizardQuery = {
  step: 'basics',
  structure: 'single-elimination',
  places: 16,
};

describe('parseWizardQuery', () => {
  test('defaults, valid values and sizes the structure lacks', () => {
    assert({
      given: 'nothing, a robin of 10, and an elimination of 10 and junk',
      should: 'default, keep the valid size, and fall back otherwise',
      actual: [
        parseWizardQuery({}),
        parseWizardQuery({
          step: 'schedule',
          structure: 'round-robin',
          places: '10',
        }),
        parseWizardQuery({ places: '10' }),
        parseWizardQuery({ step: 'x', structure: 'y', places: ['z'] }),
        parseWizardQuery({ structure: 'round-robin', places: '64' }),
      ],
      expected: [
        base,
        { step: 'schedule', structure: 'round-robin', places: 10 },
        base,
        base,
        { step: 'basics', structure: 'round-robin', places: 8 },
      ],
    });
  });
});

describe('wizardHref', () => {
  test('only non-default values are carried', () => {
    assert({
      given: 'the default, a step, and a robin of 10 on review',
      should: 'build short URLs',
      actual: [
        wizardHref(base),
        wizardHref({ ...base, step: 'rules' }),
        wizardHref({ step: 'review', structure: 'round-robin', places: 10 }),
      ],
      expected: [
        '/tournaments/organize/new',
        '/tournaments/organize/new?step=rules',
        '/tournaments/organize/new?step=review&structure=round-robin&places=10',
      ],
    });
  });
});

describe('wizardMarks', () => {
  test('earlier steps are done, each links to itself keeping the choices', () => {
    const marks = wizardMarks({ ...base, step: 'schedule', places: 32 });
    assert({
      given: 'the schedule step with 32 places',
      should:
        'mark two done, one current, two todo, all linking with places=32',
      actual: [
        marks.map((mark) => mark.state),
        marks[0]?.href,
        marks.at(-1)?.href,
      ],
      expected: [
        ['done', 'done', 'current', 'todo', 'todo'],
        '/tournaments/organize/new?places=32',
        '/tournaments/organize/new?step=review&places=32',
      ],
    });
  });
});

describe('wizardSummary', () => {
  test('elimination and round robin sizes', () => {
    const se = wizardSummary({ ...base, places: 32 });
    const rr = wizardSummary({
      step: 'basics',
      structure: 'round-robin',
      places: 8,
    });
    assert({
      given: '32 places elimination and 8 entrants round robin',
      should: 'say rounds, byes, judges needed and list round rows',
      actual: [
        se.calc,
        se.judgesNote,
        se.roundRows.map((row) => row.label),
        rr.calc,
        rr.rounds,
        rr.roundRows.length,
      ],
      expected: [
        '5 rounds',
        'Round 1 needs up to 16 judges.',
        ['Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Final'],
        '7 rounds, everyone meets once',
        7,
        7,
      ],
    });
  });

  test('sizes per structure', () => {
    assert({
      given: 'both structures',
      should: 'offer their sizes',
      actual: [sizesFor('single-elimination'), sizesFor('round-robin')],
      expected: [
        [8, 16, 32, 64],
        [4, 6, 8, 10, 12],
      ],
    });
  });
});

describe('reviewFacts', () => {
  test('seven rows naming the choices', () => {
    assert({
      given: 'a 16-place elimination',
      should: 'list the draft and the chosen structure and size',
      actual: reviewFacts(base, sampleDraft).map(
        ([label, value]) => `${label}: ${value}`,
      ),
      expected: [
        'Name: Winter Open',
        'Structure: Single elimination',
        'Places: 16, 4 rounds',
        'Registration: Opens 12 Oct, closes 5 Nov, 18:00 UTC',
        'Rules: Standard rules, unrated',
        'Judging: 1 judge',
        'Listing: Public',
      ],
    });
  });
});

describe('withStructure', () => {
  test('switching structure takes that structure’s default size', () => {
    assert({
      given: 'a 32-place elimination switched to round robin, and left alone',
      should: 'reset the size to 8, or keep the query',
      actual: [
        withStructure({ ...base, places: 32 }, 'round-robin'),
        withStructure({ ...base, places: 32 }, 'single-elimination'),
      ],
      expected: [
        { step: 'basics', structure: 'round-robin', places: 8 },
        { step: 'basics', structure: 'single-elimination', places: 32 },
      ],
    });
  });
});
