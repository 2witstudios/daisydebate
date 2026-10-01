import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { watchViewer } from './debate-source';
import { listRecordings } from './list-recordings';
import {
  defaultRecordingsQuery,
  type RecordingsQuery,
} from './recordings-query';

setupRitewayBun();

const member = watchViewer(true);
const ids = (query: RecordingsQuery) =>
  listRecordings(query, member).rows.map((row) => row.id);

describe('listRecordings over the sample debates', () => {
  test('the public archive, newest first', () => {
    assert({
      given: 'no filters',
      should: 'list only public replayable recordings',
      actual: ids(defaultRecordingsQuery),
      expected: [
        'semifinal-rehearsal',
        'evening-round',
        'open-table',
        'ladder-climb',
        'custom-rules-test',
        'season-opener',
      ],
    });
  });

  test('my debates add unlisted and private ones', () => {
    assert({
      given: 'the my-debates scope',
      should: 'list every recording the viewer played, whatever its visibility',
      actual: ids({ ...defaultRecordingsQuery, scope: 'mine' }),
      expected: ['practice-with-a-friend', 'fast-rounds', 'custom-rules-test'],
    });
  });

  test('not-ready and foreign private recordings never list', () => {
    const all = ids({ ...defaultRecordingsQuery, scope: 'mine' }).concat(
      ids(defaultRecordingsQuery),
    );
    assert({
      given: "a processing, an expired and another person's private recording",
      should: 'list none of them',
      actual: ['just-finished', 'older-round', 'closed-door-recording'].filter(
        (id) => all.includes(id),
      ),
      expected: [],
    });
  });

  test('sorts and filters', () => {
    assert({
      given: 'longest, highest rated, ranked only and a handle search',
      should: 'order and narrow the list',
      actual: [
        ids({ ...defaultRecordingsQuery, sort: 'longest' }).slice(0, 2),
        ids({ ...defaultRecordingsQuery, sort: 'rated' }).slice(0, 2),
        ids({ ...defaultRecordingsQuery, mode: 'ranked' }),
        ids({ ...defaultRecordingsQuery, q: 'DEBATER-T' }),
      ],
      expected: [
        ['season-opener', 'ladder-climb'],
        ['evening-round', 'semifinal-rehearsal'],
        [
          'semifinal-rehearsal',
          'evening-round',
          'ladder-climb',
          'season-opener',
        ],
        ['season-opener'],
      ],
    });
  });

  test('a row carries the list facts', () => {
    const { rows } = listRecordings(
      { ...defaultRecordingsQuery, scope: 'mine' },
      member,
    );
    const practice = rows[0];
    const pending = listRecordings(defaultRecordingsQuery, member).rows[1];
    assert({
      given: 'my private practice and a public pending recording',
      should:
        'show You, length, date, visibility and keep line, or a pending result',
      actual: [
        practice?.aff.name,
        practice?.length,
        practice?.date,
        practice?.result,
        practice?.own,
        pending?.result,
        pending?.pending,
        pending?.own,
        pending?.href,
      ],
      expected: [
        'You',
        '38 min',
        'Sep 27',
        'Aff wins 1–0',
        { visibility: 'Private', keptUntil: 'Kept until [date]' },
        'Result pending',
        true,
        null,
        '/recordings/evening-round',
      ],
    });
  });

  test('scope counts before filters', () => {
    assert({
      given: 'a search matching nothing',
      should: 'list nothing but count the scope',
      actual: [
        listRecordings({ ...defaultRecordingsQuery, q: 'zzz' }, member).rows
          .length,
        listRecordings({ ...defaultRecordingsQuery, q: 'zzz' }, member).inScope,
      ],
      expected: [0, 6],
    });
  });
});
