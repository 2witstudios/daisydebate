import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundView } from '@daisy/protocol/round-view';
import { mockNextRouter } from '../../lib/testing/mock-router';
import {
  renderAccessible,
  type AccessibleView,
} from '../../test-support/rendered/accessible';
import {
  asCompleted,
  neg,
  origin,
  ran,
  rules,
  startOf,
} from '../debate-room/live-round.test-support';
setupRitewayBun();
await mockNextRouter();
const { LiveSpectatorRoom, LinkedAdultEndNotice } =
  await import('./live-spectator-room');

const render = (
  round: RoundView,
  nowMs: number,
  spectatorKind: 'host' | 'linked-adult' = 'host',
) =>
  renderAccessible(
    <LiveSpectatorRoom
      view={round}
      spectatorKind={spectatorKind}
      renderedAtMs={nowMs}
      read={async () => ({
        kind: 'found',
        round,
        serverNowMs: null,
        socketUrl: null,
      })}
      socketUrl={null}
    />,
  );
/** Every control: forms, buttons and fields, hidden ones included. */
const controls = (view: AccessibleView) =>
  (['form', 'button', 'textbox', 'combobox', 'checkbox', 'radio'] as const)
    .map((role) => view.count(role, undefined, { hidden: true }))
    .reduce((sum, count) => sum + count, 0);
/** Whether any link goes somewhere under this path. */
const linksTo = (view: AccessibleView, path: string) =>
  view
    .all('link', undefined, { hidden: true })
    .some((link) => link.getAttribute('href')?.includes(path));

test('a seatless host watches the live Round without controls', () => {
  const view = render(ran(1), origin + startOf(0) + 60_000);
  const text = view.textContent();
  const debaters = view.within('list', 'Debaters').textContent();
  const speeches = view.within('region', 'Speech order');
  assert({
    given: 'the affirmative constructive a minute in, watched by its host',
    should:
      'label the host watching, show the resolution, both debaters with who speaks, the clock and the current speech, and offer no form, media or ballot',
    actual: [
      text.includes('You’re hosting · watching'),
      view.has('heading', 'Resolution', { level: 2 }),
      debaters.includes('Sam Reyes'),
      debaters.includes(neg.label),
      debaters.includes('Speaking'),
      debaters.includes('Listening'),
      speeches.has('timer', `${rules[0]!.key} · ${rules[0]!.label} 4:00`),
      speeches.count('listitem', undefined, { current: 'step' }),
      controls(view),
      text.includes('Live camera and sound'),
      linksTo(view, '/judge/ballot/'),
      view.attribute('link', 'Back to the lobby', 'href'),
    ],
    expected: [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      1,
      0,
      false,
      false,
      '/lobby',
    ],
  });
});

test("a youth debater's linked adult watches the live Round (ADR 0155)", () => {
  const view = render(ran(1), origin + startOf(0) + 60_000, 'linked-adult');
  const text = view.textContent();
  assert({
    given: 'the same Round watched by a linked coach',
    should:
      'say they are watching, never that they host, and offer no form, button or media',
    actual: [
      // Twice: the page's own heading, Watching the round, and the badge.
      text.match(/Watching/g)?.length,
      view
        .within('region', 'In this round')
        .textContent()
        .includes('· watching'),
      text.includes('hosting'),
      controls(view),
      text.includes('Live camera and sound'),
    ],
    expected: [2, true, false, 0, false],
  });
});

test('the Round ends while the host watches', () => {
  const view = render(asCompleted(ran(1)), origin);
  assert({
    given: 'a completed Round',
    should: 'say it is over and link its result',
    actual: [
      view.text('status'),
      view.attribute('link', 'See the result', 'href'),
    ],
    expected: ['This round is over.', `/rounds/${ran(1).id}`],
  });
});

test("a linked adult's view once their read is refused (ADR 0155)", () => {
  const view = renderAccessible(<LinkedAdultEndNotice roundId="r1" />);
  assert({
    given:
      'the read refused to a linked adult (the Round ended, or their link)',
    should:
      'say they can no longer watch it live, without claiming which, and link its Recording',
    actual: [
      view.text('status'),
      view.attribute('link', 'See the recording', 'href'),
    ],
    expected: ['You can no longer watch this round live.', '/recordings/r1'],
  });
});
