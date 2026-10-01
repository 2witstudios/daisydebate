import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  cardDeletedInCase,
  deleteInUse,
  importDuplicate,
  importLoginWall,
  importScanPdf,
  importUnreachable,
  saveConflict,
  shareNotAllowed,
} from '../../../features/prep/notices';
import { StateAlert } from './state-alert';

setupRitewayBun();

const render = (notice: Parameters<typeof StateAlert>[0]['notice']) =>
  renderToString(h(StateAlert, { notice }));

describe('StateAlert', () => {
  test('failures are alerts and cautions are status', () => {
    assert({
      given: 'a danger, a warning and an info notice',
      should: 'use role alert for danger only',
      actual: [
        render(importUnreachable('/r', '/p')).includes('role="alert"'),
        render(importScanPdf('/f')).includes('role="status"'),
        render(importDuplicate('/c', 't', 'd', '/n')).includes('role="status"'),
      ],
      expected: [true, true, true],
    });
  });

  test('navigation actions are links and mutations are disabled buttons', () => {
    const html = render(deleteInUse(3, '/prep/cards/x'));
    assert({
      given: 'the delete-in-use notice',
      should: 'link Keep card, disable Delete card and colour it red',
      actual: [
        html.includes('href="/prep/cards/x"'),
        /<button [^>]*disabled=""[^>]*>Delete card/.test(html) ||
          /disabled=""[^>]*class="[^"]*border-live[^"]*"/.test(html) ||
          /class="[^"]*border-live[^"]*"[^>]*disabled=""/.test(html),
        html.includes('This card is used in 3 places'),
      ],
      expected: [true, true, true],
    });
  });

  test('every remaining notice renders its title and each action once', () => {
    const notices = [
      importLoginWall(120, '/p', '/f'),
      saveConflict('12:09'),
      shareNotAllowed('[Team name]', '/c', '/k'),
      cardDeletedInCase(),
    ];
    assert({
      given: 'the login, conflict, share and deleted-card notices',
      should: 'show each title and every action label',
      actual: notices.every((notice) => {
        const html = render(notice);
        return (
          html.includes(notice.title.replace(/'/g, '&#x27;')) &&
          notice.actions.every((action) => html.includes(action.label))
        );
      }),
      expected: true,
    });
  });
});
