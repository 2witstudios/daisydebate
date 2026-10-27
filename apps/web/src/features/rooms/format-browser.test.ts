import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  browseTemplates,
  browserListing,
  browserTabs,
  casualSelection,
  catalogGroups,
  defaultChoice,
  standardOptions,
} from './format-browser';
import { unequalTemplate } from './assembly.test-support';

setupRitewayBun();

const entry = (
  formatId: string,
  label: string,
  role: 'standard' | 'template',
  family: 'policy' | 'value' | 'parli' | 'other' | null,
  leagues: readonly string[],
  searchTerms: string,
  sortOrder: number,
) => ({ formatId, label, role, family, leagues, searchTerms, sortOrder });

const catalog = [
  entry(
    'nsda-pf',
    'Public Forum',
    'template',
    'other',
    ['NSDA', 'TFA'],
    'pf crossfire',
    30,
  ),
  entry('value', 'Value', 'standard', null, [], 'value daisy', 2),
  entry(
    'nsda-ld',
    'NSDA Lincoln-Douglas',
    'template',
    'value',
    ['NSDA', 'TFA', 'CHSSA'],
    'ld lincoln douglas',
    10,
  ),
  entry(
    'nsda-policy',
    'NSDA Policy (CX)',
    'template',
    'policy',
    ['NSDA'],
    'policy cx',
    20,
  ),
  entry('policy', 'Policy', 'standard', null, [], 'policy daisy', 1),
  entry(
    'ncfca-ld',
    'NCFCA Lincoln-Douglas',
    'template',
    'value',
    ['NCFCA'],
    'ld homeschool',
    11,
  ),
];

const ids = (list: readonly { readonly formatId: string }[]) =>
  list.map((item) => item.formatId);

describe('standardOptions', () => {
  test('the standards', () => {
    assert({
      given: 'a catalog in any order',
      should: 'offer only the standards, in catalog order',
      actual: ids(standardOptions(catalog)),
      expected: ['policy', 'value'],
    });
  });
});

describe('defaultChoice', () => {
  test('a new room’s format', () => {
    assert({
      given: 'a catalog with Value, a catalog without it, and an empty one',
      should:
        'start on Value, else the first standard, else the first entry, else nothing',
      actual: [
        defaultChoice(catalog)?.formatId,
        defaultChoice(catalog.filter((item) => item.formatId !== 'value'))
          ?.formatId,
        defaultChoice(catalog.filter((item) => item.role === 'template'))
          ?.formatId,
        defaultChoice([]),
      ],
      expected: ['value', 'policy', 'nsda-pf', undefined],
    });
  });
});

describe('casualSelection', () => {
  test('a catalog choice', () => {
    assert({
      given: 'a catalog choice',
      should: 'select its pinned format and preset for a casual room',
      actual: casualSelection(unequalTemplate),
      expected: {
        kind: 'catalog',
        formatId: unequalTemplate.formatId,
        formatVersion: unequalTemplate.formatVersion,
        presetVersion: unequalTemplate.preset.version,
        competitionType: 'casual',
      },
    });
  });
});

describe('browseTemplates', () => {
  test('browsing a family', () => {
    assert({
      given: 'the Value tab with no search',
      should: 'list that family’s templates in catalog order, never a standard',
      actual: browseTemplates(catalog, { family: 'value', query: '' }).map(
        (group) => [group.family, ids(group.templates)],
      ),
      expected: [['value', ['nsda-ld', 'ncfca-ld']]],
    });
  });

  test('searching', () => {
    assert({
      given: 'a search for a league abbreviation',
      should:
        'match names, leagues and search terms across every family, grouped by family',
      actual: browseTemplates(catalog, { family: 'value', query: 'tfa' }).map(
        (group) => [group.family, ids(group.templates)],
      ),
      expected: [
        ['value', ['nsda-ld']],
        ['other', ['nsda-pf']],
      ],
    });
    assert({
      given: 'a multi-word search in any case',
      should: 'require every word',
      actual: ids(
        browseTemplates(catalog, {
          family: 'policy',
          query: 'Lincoln HOMESCHOOL',
        }).flatMap((group) => group.templates),
      ),
      expected: ['ncfca-ld'],
    });
    assert({
      given: 'a search nothing matches',
      should: 'return no groups',
      actual: browseTemplates(catalog, { family: 'other', query: 'wudc' }),
      expected: [],
    });
  });
});

const familyLabel = {
  policy: 'Policy',
  value: 'Value',
  parli: 'Parli',
  other: 'Other formats',
};

describe('catalogGroups', () => {
  test('the native select', () => {
    assert({
      given: 'standards and templates in several families',
      should: 'group Daisy standards first, then league rules by family',
      actual: catalogGroups(catalog, familyLabel).map((group) => [
        group.label,
        ids(group.options),
      ]),
      expected: [
        ['Daisy standards', ['policy', 'value']],
        ['League rules · Policy', ['nsda-policy']],
        ['League rules · Value', ['nsda-ld', 'ncfca-ld']],
        ['League rules · Other formats', ['nsda-pf']],
      ],
    });
  });
});

describe('the browse dialog', () => {
  test('tabs and listing', () => {
    assert({
      given: 'the catalog, a tab and a search',
      should:
        'offer only the families present, list the open tab, and search standards and templates alike',
      actual: {
        tabs: browserTabs(catalog, familyLabel).map((tab) => tab.key),
        standardTab: ids(
          browserListing(catalog, { query: '', tab: 'standard' }),
        ),
        valueTab: ids(browserListing(catalog, { query: '', tab: 'value' })),
        search: ids(browserListing(catalog, { query: 'policy', tab: 'value' })),
      },
      expected: {
        tabs: ['standard', 'policy', 'value', 'other'],
        standardTab: ['policy', 'value'],
        valueTab: ['nsda-ld', 'ncfca-ld'],
        search: ['policy', 'nsda-policy'],
      },
    });
  });
});
