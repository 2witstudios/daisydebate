import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  parseReviewQuery,
  reviewView,
} from '../../../features/prep/briefs/brief-review';
import { getBrief } from '../../../features/prep/briefs/get-brief';
import { getShare } from '../../../features/prep/teams/get-team';
import { ReviewPage } from './review-page';

setupRitewayBun();

const render = (id: string, params: Record<string, string> = {}) => {
  const brief = getBrief(id);
  if (brief === undefined) throw new Error(`no sample ${id}`);
  return renderToString(
    h(ReviewPage, {
      view: reviewView(brief, getShare(id), parseReviewQuery(params)),
    }),
  );
};

describe('ReviewPage', () => {
  test('the shared brief with its dialog shut', () => {
    const html = render('rights-framework');
    assert({
      given: 'the shared brief',
      should:
        'show one h1, Share as a link that opens the dialog, the comments and no dialog',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('href="/prep/briefs/rights-framework/review?share=open"'),
        html.includes('href="/prep/briefs/rights-framework"'),
        html.includes('1 open comment on this text'),
        html.includes('1 open · 1 resolved'),
        html.includes('role="dialog"'),
        html.includes('Evidence attached, 2 cards'),
      ],
      expected: [1, true, true, true, true, false, true],
    });
  });

  test('the dialog', () => {
    const html = render('rights-framework', { share: 'open' });
    assert({
      given: 'the dialog open',
      should:
        'name the dialog, list both grants with editable permissions, explain privacy and offer Done and Close as links',
      actual: [
        html.includes('aria-label="Share this brief"'),
        html.includes('Private to you until you add someone'),
        html.includes('@debater-d'),
        html.match(/<select /g)?.length === 3 &&
        !/<select [^>]*disabled/.test(html)
          ? 3
          : 0,
        html.includes('Include the 4 attached cards'),

        /href="\/prep\/briefs\/rights-framework\/review"[^>]*aria-label="Close"|aria-label="Close"[^>]*href="\/prep\/briefs\/rights-framework\/review"/.test(
          html,
        ),
        html.includes('>Done<'),
        html.includes('Stop sharing'),
        html.includes('aria-expanded="true"'),
      ],
      expected: [true, true, true, 3, true, true, true, true, true],
    });
  });

  test('refusing a team the viewer is not in', () => {
    const html = render('rights-framework', {
      share: 'open',
      add: '[Other team]',
    });
    assert({
      given: 'an add attempt for a team the viewer is not in',
      should: 'alert that only team members can be given access',
      actual: [
        html.includes('Only team members can be given access'),
        html.includes('role="alert"'),
        html.includes('admin to invite you'),
      ],
      expected: [true, true, true],
    });
  });

  test('a person that can be added, and one that cannot', () => {
    const ok = render('rights-framework', {
      share: 'open',
      add: '@debater-e',
      perm: 'comment',
    });
    const bad = render('rights-framework', { share: 'open', add: '@unknown' });
    assert({
      given: 'a known and an unknown handle',
      should: 'explain the first needs the service, and reject the second',
      actual: [
        ok.includes('@debater-e can be given “Can comment”.'),
        bad.includes('No one with that handle.'),
      ],
      expected: [true, true],
    });
  });

  test('a private brief has no comments', () => {
    const html = render('framing-pack');
    assert({
      given: 'a brief nobody can see',
      should: 'say it is private and has no comments',
      actual: [
        html.includes('Private to you'),
        html.includes('No comments yet'),
      ],
      expected: [true, true],
    });
  });
});
