import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  clearRecordingFiltersHref,
  defaultRecordingsQuery,
  isRecordingsFiltered,
  parseRecordingsQuery,
  recordingsHref,
} from './recordings-query';

setupRitewayBun();

describe('parseRecordingsQuery', () => {
  test('defaults, valid and untrusted values', () => {
    assert({
      given: 'nothing, every parameter, and junk',
      should: 'default, read, and fall back',
      actual: [
        parseRecordingsQuery({}),
        parseRecordingsQuery({
          scope: 'mine',
          mode: 'casual',
          q: ' a ',
          sort: 'longest',
        }),
        parseRecordingsQuery({
          scope: 'everyone',
          mode: ['ranked'],
          sort: '%00',
          q: 'x'.repeat(200),
        }),
      ],
      expected: [
        defaultRecordingsQuery,
        { scope: 'mine', mode: 'casual', q: 'a', sort: 'longest' },
        { ...defaultRecordingsQuery, mode: 'ranked', q: 'x'.repeat(80) },
      ],
    });
  });
});

describe('recordings hrefs', () => {
  test('shortest URL, and clearing keeps scope and sort', () => {
    const query = {
      scope: 'mine',
      mode: 'ranked',
      q: 'a',
      sort: 'rated',
    } as const;
    assert({
      given: 'default and filtered queries',
      should: 'carry only non-defaults, and clear only mode and search',
      actual: [
        recordingsHref(defaultRecordingsQuery),
        recordingsHref(query),
        clearRecordingFiltersHref(query),
        isRecordingsFiltered(query),
        isRecordingsFiltered({ ...defaultRecordingsQuery, scope: 'mine' }),
      ],
      expected: [
        '/recordings',
        '/recordings?scope=mine&mode=ranked&q=a&sort=rated',
        '/recordings?scope=mine&sort=rated',
        true,
        false,
      ],
    });
  });
});
