import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { getAssignedDebates } from '../../../features/judge/get-assigned';
import { JudgeHub } from './judge-hub';
setupRitewayBun();
test('real Judge hub projects own stored states and empty waiting without synthetic assignments', () => {
  const assigned = getAssignedDebates([
    {
      roundId: 'r'.repeat(24),
      resolution: 'Cities should fund transit',
      status: 'active',
      outcome: null,
      ballotStatus: null,
      freezeRevision: 1,
    },
  ]);
  const html = renderToString(h(JudgeHub, { assigned }));
  const empty = renderToString(
    h(JudgeHub, { assigned: getAssignedDebates([]) }),
  );
  assert({
    given: 'one actual assignment or no judge seats',
    should:
      'offer the real frozen ballot or truthful waiting, never a sample match/rating',
    actual: [
      html.match(/<h1 /g)?.length,
      html.includes(`/judge/ballot/${'r'.repeat(24)}`),
      html.includes('The recorded transcript is frozen'),
      html.includes('Start judging'),
      html.includes('Your judge rating'),
      empty.includes('No assigned Rounds'),
      empty.includes('aria-label="Assigned to you"'),
    ],
    expected: [1, true, true, false, false, true, false],
  });
});
