import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { VisibilityMark } from './visibility-mark';

setupRitewayBun();

describe('VisibilityMark', () => {
  test('private and team', () => {
    const priv = renderToString(
      h(VisibilityMark, { visibility: { kind: 'private' } }),
    );
    const team = renderToString(
      h(VisibilityMark, {
        visibility: { kind: 'team', teamName: '[Team name]' },
      }),
    );
    assert({
      given: 'a private and a team visibility',
      should: 'say Private, and Team with the team named for screen readers',
      actual: [
        priv.includes('Private'),
        team.includes('Shared with [Team name]'),
        team.includes('Team'),
      ],
      expected: [true, true, true],
    });
  });
});
