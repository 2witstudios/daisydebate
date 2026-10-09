import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { AssemblySeats } from './assembly-seats';

setupRitewayBun();

test('team cast renders actual readiness without treating empty seats as ready', () => {
  const html = renderToString(
    AssemblySeats({
      seats: { affirmative: 2, negative: 1, judge: 1 },
      participants: [
        {
          id: 'human-seat',
          actorId: 'human',
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
          kind: 'bot',
          role: 'judge',
          slot: 0,
          needsReady: false,
          ready: 'not-ready',
          eligible: false,
        },
      ],
      labels: { human: 'Real member', bot: 'Judge bot' },
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
