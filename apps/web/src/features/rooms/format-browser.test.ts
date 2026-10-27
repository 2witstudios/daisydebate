import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { browseTemplates, standardOptions } from './format-browser';

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
