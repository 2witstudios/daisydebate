import { mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();

// Static markup needs no navigation; the form's move-on hook asks for one.
mock.module('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
}));
const { RequestDecision } = await import('./request-decision');

test('a group invitation offers only Decline while private groups are off (ISSUE-643)', () => {
  const render = (acceptable: boolean) =>
    renderToStaticMarkup(
      <RequestDecision
        action={async (state) => state}
        requestId={'r'.repeat(24)}
        subject="invitation"
        acceptable={acceptable}
      />,
    );
  const off = render(false),
    on = render(true);
  assert({
    given: 'the invitation form with groups off, then on',
    should:
      'keep a native Decline in both and offer Accept only when groups are on',
    actual: [
      off.includes('value="decline"'),
      off.includes('value="accept"'),
      on.includes('value="accept"'),
    ],
    expected: [true, false, true],
  });
});
