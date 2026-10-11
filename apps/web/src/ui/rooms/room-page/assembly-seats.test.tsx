import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { AssemblySeats } from './assembly-seats';
import { pageColourClasses } from '../../test-support/stage-palette';

setupRitewayBun();

test('team cast renders actual readiness without treating empty seats as ready', () => {
  const html = renderToString(
    AssemblySeats({
      seats: { affirmative: 2, negative: 1, judge: 1 },
      participants: [
        {
          id: 'human-seat',
          actorId: 'human',
          label: 'Real member',
          consentVersion: 0,
          kind: 'human',
          role: 'affirmative',
          slot: 1,
          needsReady: true,
          ready: 'ready',
          eligible: true,
        },
        {
          id: 'bot-seat',
          actorId: 'bot',
          label: 'Judge bot',
          consentVersion: 0,
          kind: 'bot',
          role: 'judge',
          slot: 0,
          needsReady: false,
          ready: 'not-ready',
          eligible: false,
        },
      ],
    }),
  );
  assert({
    given:
      'an empty first teammate seat, a ready human and an ineligible bot judge',
    should:
      'show all four slots, actual labels and server eligibility without inventing bot Ready',
    actual: [
      (html.match(/<li /g) ?? []).length,
      (html.match(/Open seat/g) ?? []).length,
      html.includes('Affirmative 2'),
      html.includes('Real member'),
      html.includes('Judge bot'),
      html.includes('Not eligible'),
      (html.match(/>Ready</g) ?? []).length,
    ],
    expected: [4, 2, true, true, true, true, 1],
  });
});

test('gathering lineup groups sides and judges with safe stage colors and no media inference', () => {
  const html = renderToString(
    <AssemblySeats
      seats={{ affirmative: 1, negative: 2, judge: 1 }}
      participants={[]}
    />,
  );
  assert({
    given: 'an asymmetric empty cast before the round',
    should:
      'show the dominant stage, both sides and judges without invented camera status',
    actual: [
      html.includes('Take your places.'),
      html.includes('aria-label="Affirmative lineup"'),
      html.includes('aria-label="Negative lineup"'),
      html.includes('aria-label="Judges"'),
      pageColourClasses(html),
      html.includes('Camera off'),
    ],
    expected: [true, true, true, true, [], false],
  });
});
