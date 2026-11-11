import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { OUTCOME_NOTICES } from './security-notices';
import {
  openingSecurityOverview,
  reduceSecurityOverview,
  UNREACHABLE_LISTS,
  type SecurityListsAnswer,
  type SecurityOverview,
} from './security-overview-model';
import { SecurityOverviewSections } from './security-overview-sections';
import { answerOf } from './security-overview-states.test-support';

setupRitewayBun();

const screen = {
  renamePasskey: () => {},
  removePasskey: () => {},
  removeSession: () => {},
  signOutOthers: () => {},
  addPasskey: () => {},
};
const asked = reduceSecurityOverview(openingSecurityOverview(), {
  type: 'read-asked',
}).state;
const answered = (answer: SecurityListsAnswer) =>
  reduceSecurityOverview(asked, { type: 'read-answered', version: 1, answer })
    .state;

/** What the two sections say about their lists. */
const said = (overview: SecurityOverview) => {
  const html = renderToString(
    h(SecurityOverviewSections, { overview, screen }),
  );
  return {
    loadingPasskeys: html.includes('Loading passkeys…'),
    loadingSessions: html.includes('Loading sessions…'),
    lists: (html.match(/<ul/g) ?? []).length,
    rows: (html.match(/<li/g) ?? []).length,
    unavailable: ['passkeys-load-notice', 'sessions-load-notice'].filter((id) =>
      new RegExp(
        `id="${id}" role="alert"[^>]*>.*?${OUTCOME_NOTICES.unavailable}`,
      ).test(html),
    ),
  };
};

const loading = {
  loadingPasskeys: true,
  loadingSessions: true,
  lists: 0,
  rows: 0,
  unavailable: [],
};

test('the security screen before its lists are read', () => {
  assert({
    given: 'the screen as it opens, and the screen once it has asked',
    should: 'say both lists are loading, and show no list and no notice',
    actual: [said(openingSecurityOverview()), said(asked)],
    expected: [loading, loading],
  });
});

test('the security screen once a read found nothing', () => {
  assert({
    given: 'a read that said the account has no passkeys and no sessions',
    should: 'show two empty lists, and neither loading nor a notice',
    actual: said(answered(answerOf([], []))),
    expected: {
      loadingPasskeys: false,
      loadingSessions: false,
      lists: 2,
      rows: 0,
      unavailable: [],
    },
  });
});

test('the security screen once its lists could not be read', () => {
  assert({
    given: 'a read that could not be made',
    should:
      'say so once for each list, in place of its rows, and no longer say loading',
    actual: said(answered(UNREACHABLE_LISTS)),
    expected: {
      loadingPasskeys: false,
      loadingSessions: false,
      lists: 0,
      rows: 0,
      unavailable: ['passkeys-load-notice', 'sessions-load-notice'],
    },
  });
});
