import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundView } from '@daisy/protocol/round-view';
import { mockNextRouter } from '../../lib/testing/mock-router';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { view, judge } from '../debate-room/live-round.test-support';
setupRitewayBun();
await mockNextRouter();
const { LiveJudgeRoom } = await import('./live-judge-room');
const { MediaStage } = await import('../round-media/media-stage');
test('an assigned judge watches debaters without competitive controls or attendance', () => {
  const assignedView = {
    ...view,
    participants: [
      ...view.participants.filter((seat) => seat.seat.kind !== 'judge'),
      judge,
    ],
  };
  const room = renderAccessible(
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
  // Read the room before the stage render replaces the shared document.
  const roomFacts = [
    room.has('region', 'Live camera and sound'),
    room
      .all('link')
      .some((link) => link.getAttribute('href') === `/judge/ballot/${view.id}`),
    // A form has no role until it is named; any form at all here is a command.
    room
      .get('heading', 'Resolution')
      .ownerDocument.body.querySelector('form') !== null,
    room.textContent().includes('Check in'),
    room.textContent().includes('Your camera'),
    room.textContent().includes('Riley Judge'),
    room.has('heading', 'Resolution', { level: 2 }),
    room.textContent().includes('Checking this Round’s tab'),
  ];
  const stage = renderAccessible(
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
      ...roomFacts,
      stage.count('figure'),
      stage.textContent().includes('Riley Judge'),
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
    ...round.participants.filter((seat) => seat.seat.kind !== 'judge'),
    judge,
  ],
});
const render = (round: RoundView, renderedAtMs: number) =>
  renderAccessible(
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
  const room = render(judged(ran(1)), origin + startOf(0) + 60_000);
  const first = rules[0]!;
  const now = room.get('heading', `${first.key} · ${first.label}`, {
    level: 2,
  });
  assert({
    given: 'the judge’s room a minute into the first speech',
    should:
      'name the speech in the Now heading, run its timer, mark it the current step, say who speaks, and render no main landmark of its own',
    actual: [
      now.id === 'judge-now' && now.getAttribute('tabindex') === '-1',
      room.has('region', `${first.key} · ${first.label}`),
      room.count('timer') > 0,
      room.count('listitem', undefined, { current: 'step' }) > 0,
      room.textContent().includes('Sam Reyes (Affirmative) is speaking.'),
      // The polite notice is empty until the stage changes, so it has no text to name.
      now.ownerDocument.body.querySelector('[aria-live="polite"]') !== null,
      room.count('main'),
      room.textContent().includes('Open your ballot'),
      room.has('link', 'Preview your ballot'),
    ],
    expected: [true, true, true, true, true, true, 0, false, true],
  });
});

test('once the speeches end, the ballot is the judge’s action', () => {
  const closed = judged(ran(rules.length, true));
  const room = render(
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
      room.textContent().includes('The speeches are over'),
      room.has('timer', 'Judging window 29:00'),
      room.has('link', 'Open your ballot'),
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
