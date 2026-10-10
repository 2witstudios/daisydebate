import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { RoundReceipt } from './round-receipt';

setupRitewayBun();

test('persisted scheduled Round renders the frozen asymmetric schedule and cast', () => {
  const html = renderToStaticMarkup(
    <RoundReceipt
      round={{
        id: 'round-owned',
        roomId: 'room-owned',
        status: 'scheduled',
        topic: '<Frozen topic>',
        config: { preRoundPrep: { enabled: true, durationMs: 45000 } },
        rules: {
          countdownMs: 2000,
          inRoundPrep: null,
          interaction: {
            crossExMode: 'free',
            yield: null,
            interruptions: null,
          },
          segments: [
            {
              key: 'A2',
              label: 'Aff reply',
              type: 'speech',
              side: 'affirmative',
              slot: 1,
              durationMs: 125000,
            },
            {
              key: 'N1',
              label: 'Neg closing',
              type: 'speech',
              side: 'negative',
              slot: 0,
              durationMs: 90000,
            },
          ],
        },
        participants: [
          {
            id: 'seat-a',
            actorId: 'actor-a',
            kind: 'human',
            label: 'Alice',
            role: 'affirmative',
            slot: 1,
          },
          {
            id: 'seat-j',
            actorId: 'actor-j',
            kind: 'bot',
            label: 'Judge Sage',
            role: 'judge',
            slot: 0,
          },
        ],
      }}
    />,
  );
  assert({
    given:
      'a scheduled Round with unequal frozen speech lengths and an AI judge',
    should:
      'show its real receipt, ordered slots and exact durations without implying media or a ballot exists',
    actual: [
      html.includes('&lt;Frozen topic&gt;'),
      html.includes('Scheduled'),
      html.includes('0m 45s'),
      html.includes('free'),
      html.includes('Affirmative 2'),
      html.includes('2m 5s'),
      html.includes('1m 30s'),
      html.indexOf('Aff reply') < html.indexOf('Neg closing'),
      html.includes('Judge Sage'),
      html.includes('AI'),
      html.includes('/rooms/room-owned'),
      html.includes('Media and judging are not available yet.'),
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
      true,
      true,
      true,
    ],
  });
});
