import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundBallotRead } from '@daisy/protocol';
import { ballotDraftKey } from '../../../features/judge/ballot-draft';
import { judge, view } from '../../debate-room/live-round.test-support';
import { mountBrowserClient } from '../../test-support/browser-client.test-support';
import type * as Client from './use-ballot-draft.test-support';

setupRitewayBun();

const read = {
  round: view,
  own: { participantId: judge.id, ballot: null, freezeRevision: null },
} as unknown as RoundBallotRead;
const key = ballotDraftKey(view.id, judge.id);
const kept = { winner: 'negative', reason: 'Clearer weighing.' };

test('the ballot draft restores, yields to a refusal and is removed once recorded', async () => {
  const { act, createElement, root, DraftProbe, container, browser } =
    await mountBrowserClient<typeof Client>(
      Bun.resolveSync('./use-ballot-draft.test-support', import.meta.dir),
    );
  browser.sessionStorage.setItem(key, JSON.stringify(kept));
  const show = async (
    display: 'open' | 'recorded',
    posted: Readonly<Record<string, string>>,
  ) => {
    await act(async () =>
      root.render(createElement(DraftProbe, { view: read, display, posted })),
    );
    return JSON.parse(container.querySelector('output')!.textContent!);
  };
  try {
    const restored = await show('open', {});
    const refused = await show('open', { winner: 'affirmative' });
    await show('recorded', {});
    assert({
      given:
        'a kept draft on an open ballot, then a refusal’s posted values, then the ballot recorded',
      should:
        'hand the fields the draft, then the posted values, then remove the draft from this tab',
      actual: [restored, refused, browser.sessionStorage.getItem(key)],
      expected: [
        { restored: true, values: kept },
        { restored: false, values: { winner: 'affirmative' } },
        null,
      ],
    });
  } finally {
    await act(async () => root.unmount());
  }
});
