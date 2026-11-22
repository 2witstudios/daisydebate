import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundView } from '@daisy/protocol/round-view';
import { mockNextRouter } from '../../lib/testing/mock-router';
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
  renderToStaticMarkup(
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

test('a seatless host watches the live Round without controls', () => {
  const html = render(ran(1), origin + startOf(0) + 60_000);
  assert({
    given: 'the affirmative constructive a minute in, watched by its host',
    should:
      'label the host watching, show the resolution, both debaters with who speaks, the clock and the current speech, and offer no form, media or ballot',
    actual: [
      html.includes('You’re hosting · watching'),
      html.includes('>Resolution</h2>'),
      html.includes('Sam Reyes'),
      html.includes(neg.label),
      html.includes('>Speaking</span>'),
      html.includes('>Listening</span>'),
      html.includes(`${rules[0]!.key} · ${rules[0]!.label}`),
      html.includes('4:00'),
      html.includes('aria-current="step"'),
      html.includes('<form'),
      html.includes('<button'),
      html.includes('Live camera and sound'),
      html.includes('/judge/ballot/'),
      html.includes('href="/lobby"'),
    ],
    expected: [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      true,
    ],
  });
});

test("a youth debater's linked adult watches the live Round (ADR 0155)", () => {
  const html = render(ran(1), origin + startOf(0) + 60_000, 'linked-adult');
  assert({
    given: 'the same Round watched by a linked coach',
    should:
      'say they are watching, never that they host, and offer no form, button or media',
    actual: [
      html.includes('>Watching</span>'),
      html.includes('· watching'),
      html.includes('hosting'),
      html.includes('<form'),
      html.includes('<button'),
      html.includes('Live camera and sound'),
    ],
    expected: [true, true, false, false, false, false],
  });
});

test('the Round ends while the host watches', () => {
  const html = render(asCompleted(ran(1)), origin);
  assert({
    given: 'a completed Round',
    should: 'say it is over and link its result',
    actual: [
      html.includes('This round is over.'),
      html.includes(`/rounds/${ran(1).id}`),
    ],
    expected: [true, true],
  });
});

test("a linked adult's view once their read is refused (ADR 0155)", () => {
  const html = renderToStaticMarkup(<LinkedAdultEndNotice roundId="r1" />);
  assert({
    given:
      'the read refused to a linked adult (the Round ended, or their link)',
    should:
      'say they can no longer watch it live, without claiming which, and link its Recording',
    actual: [
      html.includes('You can no longer watch this round live.'),
      html.includes('href="/recordings/r1"'),
    ],
    expected: [true, true],
  });
});
