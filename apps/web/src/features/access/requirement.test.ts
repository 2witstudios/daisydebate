import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { guardedAreaFor, requirementFor } from './decision';

setupRitewayBun();

describe('guarded areas under a public root', () => {
  test('a public root can hold guarded children, matched longest first', () => {
    assert({
      given:
        'the public /tournaments root, its guarded areas, descendants and lookalikes',
      should:
        'guard only the named areas and their descendants, on a segment boundary',
      actual: [
        '/tournaments',
        '/tournaments/',
        '/tournaments/autumn-open',
        '/tournaments/autumn-open/bracket',
        '/tournaments/organize',
        '/tournaments/organize/',
        '/tournaments/organize/x',
        '/tournaments/organize/x/y',
        '/tournaments/mine',
        '/tournaments/mine/x/room/semifinal-1',
        '/tournaments/enter/x',
        '/tournaments/mineral',
        '/tournaments/mineral/x',
        '/tournaments/organizer',
        '/tournaments/Organize',
        '/Tournaments/organize',
      ].map(requirementFor),
      expected: [
        null,
        null,
        null,
        null,
        'participant',
        'participant',
        'participant',
        'participant',
        'participant',
        'participant',
        'participant',
        null,
        null,
        null,
        null,
        null,
      ],
    });
  });

  test('malformed paths never unguard an area', () => {
    assert({
      given: 'double slashes inside a guarded path and before a single segment',
      should:
        'collapse interior empties, and leave a leading double slash as today',
      actual: [
        '/tournaments//organize',
        '/tournaments/organize//x',
        '/lobby//x',
        '//lobby',
        '',
      ].map(requirementFor),
      expected: ['participant', 'participant', 'participant', null, null],
    });
  });

  test('guardedAreaFor names the matched area', () => {
    assert({
      given: 'a nested guarded path, a single-segment one and a public one',
      should: 'answer the longest matching area, or null',
      actual: [
        '/tournaments/organize/x',
        '/lobby/abc',
        '/tournaments/autumn-open',
      ].map(guardedAreaFor),
      expected: ['/tournaments/organize', '/lobby', null],
    });
  });
});
