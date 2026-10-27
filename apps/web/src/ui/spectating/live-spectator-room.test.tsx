import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundView } from '@daisy/protocol';
import { mockNextRouter } from '../../lib/testing/mock-router';
import {
  neg,
  origin,
  ran,
  rules,
  startOf,
} from '../debate-room/live-round.test-support';
setupRitewayBun();
await mockNextRouter();
const { LiveSpectatorRoom } = await import('./live-spectator-room');

const render = (round: RoundView, nowMs: number) =>
  renderToStaticMarkup(
    <LiveSpectatorRoom
      view={round}
      audience="host"
      renderedAtMs={nowMs}
      read={async () => ({ kind: 'found', round })}
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

test('the Round ends while the host watches', () => {
  const html = render({ ...ran(1), status: 'completed' }, origin);
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
