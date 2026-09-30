import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseRoomPanelQuery, roomPanelHref } from './room-panel-query';

setupRitewayBun();

const blank = {
  pin: '',
  version: 0,
  tab: 'speech',
  card: '',
  send: false,
  keep: false,
  q: '',
  open: false,
  hidden: false,
};

describe('parseRoomPanelQuery', () => {
  test('defaults, values and junk', () => {
    assert({
      given: 'nothing, a full state, and junk',
      should: 'parse or fall back to the blank state',
      actual: [
        parseRoomPanelQuery({}),
        parseRoomPanelQuery({
          pin: 'aff-rights',
          v: '3',
          tab: 'cards',
          card: 'pilot-results',
          send: '1',
          keep: '1',
          q: ' rights ',
          open: '1',
          hide: '1',
        }),
        parseRoomPanelQuery({
          pin: '../x',
          v: '-1',
          tab: 'admin',
          send: 'yes',
          open: '2',
        }),
      ],
      expected: [
        blank,
        {
          pin: 'aff-rights',
          version: 3,
          tab: 'cards',
          card: 'pilot-results',
          send: true,
          keep: true,
          q: 'rights',
          open: true,
          hidden: true,
        },
        blank,
      ],
    });
  });

  test('hrefs round-trip', () => {
    assert({
      given: 'a blank and a full state',
      should: 'omit defaults and round-trip the rest',
      actual: [
        roomPanelHref({}),
        roomPanelHref({
          pin: 'aff-rights',
          version: 3,
          tab: 'cards',
          send: true,
          open: true,
        }),
      ],
      expected: [
        '/prep/in-debate',
        '/prep/in-debate?pin=aff-rights&v=3&tab=cards&send=1&open=1',
      ],
    });
  });
});
