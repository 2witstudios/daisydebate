import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { sampleRound } from '../ui/mock/debate-room.test-support';
import { RoundBar } from '../ui/debate-room/round-bar';

setupRitewayBun();

/**
 * Which strip items show at which width is a visual contract carried only by
 * the strip's classes (`round-speech-narrow` shows below the strip's
 * container breakpoint only): no accessible equivalent says it.
 */
test('a finished round reads All done at every width', () => {
  const base = sampleRound('opponent-speaking', 'casual');
  const html = renderMarkup(
    h(RoundBar, {
      round: { ...base, liveIndex: base.speeches.length },
      leave: {
        confirming: false,
        stayHref: '',
        confirmHref: '?leave',
        leaveHref: '/lobby',
      },
    }),
  );
  const strip = html.slice(html.indexOf('aria-label="Speeches"'));
  const done = strip.slice(0, strip.indexOf('All done'));
  assert({
    given: 'every speech over (the round is being judged)',
    should: 'say All done outside the narrow-only class',
    actual: [
      strip.includes('All done'),
      done.slice(done.lastIndexOf('<li')).includes('round-speech-narrow'),
    ],
    expected: [true, false],
  });
});
