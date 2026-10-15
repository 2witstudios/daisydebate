import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { AssemblySeats } from './assembly-seats';

import { seatIntents } from './seat-intents.test-support';

setupRitewayBun();

const intents = seatIntents;
const viewer = { actorId: 'v'.repeat(24), label: 'Viewer' };
const bot = {
  actorId: 't'.repeat(24),
  kind: 'bot' as const,
  label: 'Penny',
  eligible: true,
};
const occupied = {
  ...assemblySnapshot,
  participants: [
    {
      id: 'h'.repeat(24),
      actorId: viewer.actorId,
      label: 'Real member',
      consentVersion: 0,
      kind: 'human' as const,
      role: 'affirmative' as const,
      slot: 1,
      needsReady: true,
      ready: 'ready' as const,
      eligible: true,
    },
    {
      id: 'b'.repeat(24),
      actorId: bot.actorId,
      label: 'Judge bot',
      consentVersion: 0,
      kind: 'bot' as const,
      role: 'judge' as const,
      slot: 0,
      needsReady: false,
      ready: 'not-ready' as const,
      eligible: false,
    },
  ],
};

test('seat rows render actual readiness without treating empty seats as ready', () => {
  const html = renderToStaticMarkup(
    <AssemblySeats view={occupied} viewer={viewer} bots={[]} {...intents} />,
  );
  assert({
    given:
      'two aff and three neg seats, a ready viewer and an ineligible bot judge',
    should:
      'show all six seats with actual labels, server eligibility and no invented bot Ready',
    actual: [
      (html.match(/<li /g) ?? []).length,
      (html.match(/>Open</g) ?? []).length,
      html.includes('>You<'),
      html.includes('Judge bot · AI'),
      html.includes('Not eligible'),
      (html.match(/>Ready</g) ?? []).length,
    ],
    expected: [6, 4, true, true, true, 1],
  });
});

test('open judge seat offers invite and, to the host, an AI judge', () => {
  const host = renderToStaticMarkup(
    <AssemblySeats
      view={assemblySnapshot}
      viewer={viewer}
      bots={[bot]}
      {...intents}
    />,
  );
  const guest = renderToStaticMarkup(
    <AssemblySeats
      view={{
        ...assemblySnapshot,
        capabilities: { ...assemblySnapshot.capabilities, host: false },
      }}
      viewer={viewer}
      bots={[bot]}
      {...intents}
    />,
  );
  const aiForm = host.slice(host.indexOf('value="ai-5"'));
  assert({
    given: 'an open judge seat seen by the host and by a guest',
    should:
      'offer Take and Invite to both, and an AI judge assignment of an eligible bot to the host alone',
    actual: [
      host.includes('Take Judge 1'),
      host.includes(`href="/rooms/${assemblySnapshot.id}"`),
      host.includes('>AI judge</button>'),
      aiForm.includes(`name="actorId" value="${bot.actorId}"`),
      aiForm.includes('name="role" value="judge"'),
      guest.includes('Take Judge 1'),
      guest.includes('>Invite</a>'),
      guest.includes('AI judge'),
      guest.includes('Manage seats'),
    ],
    expected: [true, true, true, true, true, true, true, false, false],
  });
});

test('an anonymous human judge (DEC-174)', () => {
  const html = renderToStaticMarkup(
    <AssemblySeats
      view={{
        ...occupied,
        participants: [
          occupied.participants[0]!,
          {
            role: 'judge',
            kind: 'human',
            slot: 0,
            anonymous: true,
            needsReady: true,
            ready: 'ready',
            eligible: true,
          },
        ],
      }}
      viewer={viewer}
      bots={[]}
      {...intents}
    />,
  );
  assert({
    given: 'a debater’s view of a seated, ready human judge',
    should: 'show the seat as Judge with its ready state and no name',
    actual: [
      html.includes('>Judge<'),
      (html.match(/>Ready</g) ?? []).length,
      html.includes('undefined'),
    ],
    expected: [true, 2, false],
  });
});
