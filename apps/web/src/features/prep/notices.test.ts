import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  cardDeletedInCase,
  citationIncomplete,
  deleteInUse,
  importDuplicate,
  importLoginWall,
  importScanPdf,
  importUnreachable,
  saveConflict,
  shareNotAllowed,
} from './notices';

setupRitewayBun();

describe('notices', () => {
  test('tones', () => {
    assert({
      given: 'each notice',
      should:
        'use danger for failures, warning for cautions, info for duplicates',
      actual: [
        importUnreachable('/r', '/p').tone,
        importLoginWall(120, '/p', '/f').tone,
        importScanPdf('/f').tone,
        importDuplicate('/c', 't', 'd', '/n').tone,
        citationIncomplete('publication date').tone,
        saveConflict('12:09').tone,
        shareNotAllowed('T', '/c', '/k').tone,
        cardDeletedInCase().tone,
        deleteInUse(3, '/k').tone,
      ],
      expected: [
        'danger',
        'warning',
        'warning',
        'info',
        'warning',
        'danger',
        'danger',
        'warning',
        'danger',
      ],
    });
  });

  test('copy carries the facts it is given', () => {
    assert({
      given: 'a login wall of 120 words and a card used once',
      should: 'name the words and pick the singular',
      actual: [
        importLoginWall(120, '/p', '/f').body.startsWith(
          'We only saw the first 120 words.',
        ),
        deleteInUse(1, '/k').title,
        deleteInUse(3, '/k').title,
        saveConflict('12:09').title,
      ],
      expected: [
        true,
        'This card is used in 1 place',
        'This card is used in 3 places',
        'This brief was edited on another device at 12:09',
      ],
    });
  });

  test('navigation actions have a destination, mutations do not', () => {
    assert({
      given: 'the delete and conflict notices',
      should: 'leave delete and the conflict choices inert but link Keep card',
      actual: [
        deleteInUse(3, '/k').actions.map((a) => a.href ?? null),
        saveConflict('12:09').actions.map((a) => a.href ?? null),
      ],
      expected: [
        [null, '/k'],
        [null, null, null],
      ],
    });
  });
});
