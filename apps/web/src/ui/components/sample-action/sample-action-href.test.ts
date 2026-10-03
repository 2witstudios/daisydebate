import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  dismissedHref,
  sampleActionHref,
  sampleActionMessage,
} from './sample-action-href';

setupRitewayBun();

describe('sampleActionHref', () => {
  test('a page with no query', () => {
    assert({
      given: 'a path and no query',
      should: 'add only the did label',
      actual: sampleActionHref('/prep', '', 'Save card'),
      expected: '/prep?did=Save+card',
    });
  });

  test('a page with its own query', () => {
    assert({
      given: 'a path whose query already holds a filter and an older did',
      should: 'keep the filter and replace the label',
      actual: sampleActionHref('/prep', 'tab=cards&did=Old', 'Share brief'),
      expected: '/prep?tab=cards&did=Share+brief',
    });
  });
});

describe('dismissedHref', () => {
  test('only the banner in the query', () => {
    assert({
      given: 'a query holding only did',
      should: 'return the bare path',
      actual: dismissedHref('/prep', 'did=Save+card'),
      expected: '/prep',
    });
  });

  test('a filter beside the banner', () => {
    assert({
      given: 'a query holding a filter and did',
      should: 'keep the filter',
      actual: dismissedHref('/prep', 'tab=cards&did=Save+card'),
      expected: '/prep?tab=cards',
    });
  });
});

describe('sampleActionMessage', () => {
  test('a label', () => {
    assert({
      given: 'a label',
      should: 'say it worked on sample data and nothing was saved',
      actual: sampleActionMessage('Remind me'),
      expected: 'Remind me: done on sample data. Nothing was saved or sent.',
    });
  });

  test('no label or a blank one', () => {
    assert({
      given: 'a missing label and a blank label',
      should: 'show no banner',
      actual: [sampleActionMessage(null), sampleActionMessage('   ')],
      expected: [null, null],
    });
  });

  test('a very long label', () => {
    assert({
      given: 'a label of 200 characters in a hand-edited address',
      should: 'cut it to 80 characters before it is shown',
      actual: sampleActionMessage('x'.repeat(200))?.startsWith(
        `${'x'.repeat(80)}:`,
      ),
      expected: true,
    });
  });
});
