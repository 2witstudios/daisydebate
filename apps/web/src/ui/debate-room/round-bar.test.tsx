import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleRound } from '../mock/debate-room.test-support';
import {
  renderAccessible,
  type AccessibleView,
} from '../../test-support/rendered/accessible';
import type { LeaveLinks } from './leave-room';
import { RoundBar } from './round-bar';

setupRitewayBun();

/** RoundBar's leave shape; these tests never follow its links. */
const noLeave: LeaveLinks = {
  confirming: false,
  stayHref: '',
  confirmHref: '?leave',
  leaveHref: '/lobby',
};

/** What each item of the Speeches strip says, in order. */
const strip = (view: AccessibleView) =>
  view
    .within('list', 'Speeches')
    .all('listitem')
    .map((item) => item.textContent);

describe('RoundBar vocabulary', () => {
  const bar = (roomNumber?: number) =>
    renderAccessible(
      h(RoundBar, {
        round: sampleRound('opponent-speaking', 'casual'),
        ...(roomNumber === undefined ? {} : { roomNumber }),
        leave: noLeave,
      }),
    );

  test('the resolution is labelled and the live speech reads by its full name', () => {
    const round = sampleRound('opponent-speaking', 'casual');
    const live = round.speeches[round.liveIndex]!;
    const view = bar();
    const text = view.textContent();
    assert({
      given: 'a debater on the affirmative while the negative speaks',
      should:
        'label the resolution, name the live speech in full, and say which side the viewer is on',
      actual: [
        view.has('heading', `Resolution ${round.resolution}`, { level: 1 }),
        view
          .within('list', 'Speeches')
          .text('listitem', undefined, { current: 'step' }),
        text.includes(
          round.self.side === 'aff' ? 'You’re Affirmative' : 'You’re Negative',
        ),
        view.has('list', 'Speech order'),
      ],
      expected: [true, `${live.code} · ${live.name}`, true, true],
    });
  });

  test('a room number shows only when the round carries one', () => {
    assert({
      given: 'no room number, then room 4',
      should: 'render nothing, then Room 4',
      actual: [
        bar().textContent().includes('Room 4'),
        bar(4).textContent().includes('Room 4 · '),
      ],
      expected: [false, true],
    });
  });

  test('a long format draws only the live speech and the next', () => {
    const base = sampleRound('opponent-speaking', 'casual');
    const speeches = Array.from({ length: 12 }, (_, i) => ({
      ...base.speeches[0]!,
      id: `${i}-S${i}`,
      code: `S${i}`,
      name: `Speech number ${i}`,
    }));
    const view = renderAccessible(
      h(RoundBar, {
        round: { ...base, speeches, liveIndex: 5 },
        leave: noLeave,
      }),
    );
    const order = view.within('list', 'Speech order').textContent();
    assert({
      given: 'twelve speeches with the sixth live',
      should:
        'name the live one in full, show the next code, count the rest, and keep every speech in the order',
      actual: [strip(view), speeches.every((s) => order.includes(s.name))],
      expected: [
        ['5 done', 'S5 · Speech number 5', 'S6', '+5 more', '6 of 12'],
        true,
      ],
    });
  });

  test('a finished round reads All done at every width', () => {
    const base = sampleRound('opponent-speaking', 'casual');
    const view = renderAccessible(
      h(RoundBar, {
        round: { ...base, liveIndex: base.speeches.length },
        leave: noLeave,
      }),
    );
    // That All done shows at every width (no narrow-only class) is a
    // markup contract: markup-contracts/round-bar.
    assert({
      given: 'every speech over (the round is being judged)',
      should: 'say All done, with no live chip and no done count',
      actual: [
        strip(view),
        view
          .within('list', 'Speeches')
          .has('listitem', undefined, { current: 'step' }),
      ],
      expected: [['All done'], false],
    });
  });
});
