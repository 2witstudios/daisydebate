import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleRound } from '../mock/debate-room.test-support';
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

describe('RoundBar vocabulary', () => {
  const bar = (roomNumber?: number) =>
    renderToString(
      h(RoundBar, {
        round: sampleRound('opponent-speaking', 'casual'),
        ...(roomNumber === undefined ? {} : { roomNumber }),
        leave: noLeave,
      }),
    );

  test('the resolution is labelled and the live speech reads by its full name', () => {
    const round = sampleRound('opponent-speaking', 'casual');
    const live = round.speeches[round.liveIndex]!;
    const html = bar();
    assert({
      given: 'a debater on the affirmative while the negative speaks',
      should:
        'label the resolution, name the live speech in full, and say which side the viewer is on',
      actual: [
        html.includes('Resolution'),
        html.includes(round.resolution),
        html.includes(`${live.code} · ${live.name}`),
        html.includes(
          round.self.side === 'aff' ? 'You’re Affirmative' : 'You’re Negative',
        ),
        html.includes('aria-label="Speech order"'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('a room number shows only when the round carries one', () => {
    assert({
      given: 'no room number, then room 4',
      should: 'render nothing, then Room 4',
      actual: [bar().includes('Room 4'), bar(4).includes('Room 4 · ')],
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
    const html = renderToString(
      h(RoundBar, {
        round: { ...base, speeches, liveIndex: 5 },
        leave: noLeave,
      }),
    );
    const strip = html.slice(html.indexOf('aria-label="Speeches"'));
    assert({
      given: 'twelve speeches with the sixth live',
      should:
        'name the live one in full, show the next code, count the rest, and keep every speech in the order',
      actual: [
        strip.includes('S5 · Speech number 5'),
        strip.includes('>S6<'),
        strip.includes('>S7<'),
        />5<span class="sr-only"> done</.test(strip),
        /\+(<!-- -->)?5<span class="sr-only"> more</.test(strip),
        strip.includes('6 of 12'),
        speeches.every((s) => html.includes(s.name)),
      ],
      expected: [true, true, false, true, true, true, true],
    });
  });

  test('a finished round reads All done at every width', () => {
    const base = sampleRound('opponent-speaking', 'casual');
    const html = renderToString(
      h(RoundBar, {
        round: { ...base, liveIndex: base.speeches.length },
        leave: noLeave,
      }),
    );
    const strip = html.slice(html.indexOf('aria-label="Speeches"'));
    const done = strip.slice(0, strip.indexOf('All done'));
    assert({
      given: 'every speech over (the round is being judged)',
      should:
        'say All done outside the narrow-only class, with no live chip and no done count',
      actual: [
        strip.includes('All done'),
        done.slice(done.lastIndexOf('<li')).includes('round-speech-narrow'),
        strip.includes('aria-current="step"'),
        strip.includes('<span class="sr-only"> done</span>'),
      ],
      expected: [true, false, false, false],
    });
  });
});
