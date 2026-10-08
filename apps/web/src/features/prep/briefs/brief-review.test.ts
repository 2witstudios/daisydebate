import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseReviewQuery, reviewHref, reviewView } from './brief-review';
import { requireBrief } from './brief.test-support';
import { getShare } from '../teams/get-team';

setupRitewayBun();

const view = (id: string, params: Record<string, string> = {}) =>
  reviewView(requireBrief(id), getShare(id), parseReviewQuery(params));

describe('parseReviewQuery', () => {
  test('defaults and values', () => {
    assert({
      given: 'nothing, and an open dialog with an add attempt',
      should: 'close the dialog by default and read the add row',
      actual: [
        parseReviewQuery({}),
        parseReviewQuery({
          share: 'open',
          add: ' @debater-e ',
          perm: 'comment',
        }),
        parseReviewQuery({ share: 'maybe' }).share,
      ],
      expected: [
        { share: false, add: '', perm: 'view' },
        { share: true, add: '@debater-e', perm: 'comment' },
        false,
      ],
    });
  });

  test('hrefs', () => {
    assert({
      given: 'a brief id',
      should: 'link to the page, and to the page with the dialog open',
      actual: [reviewHref('b', false), reviewHref('b', true)],
      expected: ['/prep/briefs/b/review', '/prep/briefs/b/review?share=open'],
    });
  });
});

describe('reviewView', () => {
  test('a shared brief with comments', () => {
    const v = view('rights-framework');
    assert({
      given: 'the shared sample brief',
      should:
        'say who it is shared with, count open comments and leave the dialog shut',
      actual: [
        v.sharedLine,
        v.openComments,
        v.threadSummary,
        v.share,
        v.evidence.length,
      ],
      expected: ['Shared with [Team name]', 1, '1 open · 1 resolved', null, 2],
    });
  });

  test('a private brief', () => {
    const v = view('framing-pack');
    assert({
      given: 'a brief nobody can see',
      should: 'say it is private and have no comments',
      actual: [v.sharedLine, v.threads.length],
      expected: ['Private to you', 0],
    });
  });

  test('the open dialog', () => {
    const v = view('rights-framework', { share: 'open' });
    assert({
      given: 'the dialog open',
      should:
        'list both grants, count the brief’s cards once each and have no notice',
      actual: [
        v.share?.grants.map((g) => g.name),
        v.share?.cardCount,
        v.share?.notice,
      ],
      expected: [['[Team name]', '@debater-d'], 4, null],
    });
  });

  test('adding a team the viewer is not in is refused', () => {
    const v = view('rights-framework', { share: 'open', add: '[Other team]' });
    assert({
      given: 'a team the viewer does not belong to',
      should: 'raise the not-allowed notice and keep the brief private from it',
      actual: [v.share?.target.kind, v.share?.notice?.title],
      expected: ['not-a-member', 'Only team members can be given access'],
    });
  });

  test('adding a person, a member team, and nonsense', () => {
    const kinds = ['@debater-e', '[Team name]', '@unknown', 'whoever'].map(
      (add) =>
        view('rights-framework', { share: 'open', add }).share?.target.kind,
    );
    assert({
      given:
        'a handle, a team the viewer is in, an unknown handle and free text',
      should: 'be ready, ready, unknown and invalid',
      actual: kinds,
      expected: ['ready', 'ready', 'unknown', 'invalid'],
    });
  });
});
