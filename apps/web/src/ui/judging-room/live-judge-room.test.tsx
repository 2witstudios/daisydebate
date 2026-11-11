import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundView } from '@daisy/protocol';
import { mockNextRouter } from '../../lib/testing/mock-router';
import { view, judge } from '../debate-room/live-round.test-support';
setupRitewayBun();
await mockNextRouter();
const { LiveJudgeRoom } = await import('./live-judge-room');
const { MediaStage } = await import('../../features/round-media/media-stage');
test('an assigned judge watches debaters without competitive controls or attendance', () => {
  const assignedView = {
    ...view,
    participants: [
      ...view.participants.filter((seat) => seat.role !== 'judge'),
      judge,
    ],
  };
  const html = renderToStaticMarkup(
    <LiveJudgeRoom
      renderedAtMs={0}
      actorId="a"
      view={assignedView}
      read={async () => ({
        kind: 'found',
        round: assignedView,
        serverNowMs: null,
        socketUrl: null,
      })}
      socketUrl={null}
    />,
  );
  // One seat's identity admits one connection, so the stage waits for this tab's claim.
  const stage = renderToStaticMarkup(
    <MediaStage
      view={assignedView}
      media={null}
      connection="live"
      microphoneConfirmed
      tracks={[]}
      handles={[]}
      ownIdentity={null}
      ownMuted={false}
      remotePeers={[]}
    />,
  );
  assert({
    given:
      'the private own-assignment view includes the caller’s named human judge seat',
    should:
      'mount real media, link the native ballot, label the resolution and omit attendance, commands and judge tiles',
    actual: [
      html.includes('aria-label="Live camera and sound"'),
      html.includes(`/judge/ballot/${view.id}`),
      html.includes('<form'),
      html.includes('Check in'),
      html.includes('Your camera'),
      html.includes('Riley Judge'),
      html.includes('>Resolution</h2>'),
      html.includes('Checking this Round’s tab'),
      stage.match(/<figure/g)?.length,
      stage.includes('Riley Judge'),
    ],
    expected: [true, true, false, false, false, false, true, true, 2, false],
  });
});

const { ran, rules, origin, startOf } =
  await import('../debate-room/live-round.test-support');
const { focusIsFree } = await import('./judge-now');

const judged = <V extends RoundView>(round: V) => ({
  ...round,
  participants: [
    ...round.participants.filter((seat) => seat.role !== 'judge'),
    judge,
  ],
});
const render = (round: RoundView, renderedAtMs: number) =>
  renderToStaticMarkup(
    <LiveJudgeRoom
      renderedAtMs={renderedAtMs}
      actorId={judge.actorId}
      view={round}
      read={async () => ({
        kind: 'found',
        round,
        serverNowMs: null,
        socketUrl: null,
      })}
      socketUrl={null}
    />,
  );

test('a judge follows a speech as the debaters do', () => {
  const html = render(judged(ran(1)), origin + startOf(0) + 60_000);
  const first = rules[0]!;
  assert({
    given: 'the judge’s room a minute into the first speech',
    should:
      'name the speech in the Now heading, run its timer, mark it the current step, say who speaks, and render no main landmark of its own',
    actual: [
      html.includes(`id="judge-now" tabindex="-1"`),
      html.includes(`>${first.key} · ${first.label}</h2>`),
      html.includes('role="timer"'),
      html.includes('aria-current="step"'),
      html.includes('Sam Reyes (Affirmative) is speaking.'),
      html.includes('aria-live="polite"'),
      html.includes('<main'),
      html.includes('Open your ballot'),
      html.includes('Preview your ballot'),
    ],
    expected: [true, true, true, true, true, true, false, false, true],
  });
});

test('once the speeches end, the ballot is the judge’s action', () => {
  const closed = judged(ran(rules.length, true));
  const html = render(
    {
      ...closed,
      waitingOn: {
        state: 'human_window',
        deadlineAt: new Date(
          origin + startOf(rules.length) + 30 * 60_000,
        ).toISOString(),
      },
    },
    origin + startOf(rules.length) + 60_000,
  );
  assert({
    given: 'every speech over and the judging window open a minute',
    should: 'count the window down and offer Open your ballot',
    actual: [
      html.includes('The speeches are over'),
      html.includes('aria-label="Judging window 29:00"'),
      html.includes('>Open your ballot</a>'),
    ],
    expected: [true, true, true],
  });
});

test('a stage change takes focus only when nothing holds it', () => {
  const body = { id: 'body' } as unknown as Element;
  const field = { id: 'field' } as unknown as Element;
  assert({
    given: 'focus on the page body, on nothing, and on a field',
    should: 'be free for the first two only',
    actual: [
      focusIsFree(body, body),
      focusIsFree(null, body),
      focusIsFree(field, body),
    ],
    expected: [true, true, false],
  });
});
