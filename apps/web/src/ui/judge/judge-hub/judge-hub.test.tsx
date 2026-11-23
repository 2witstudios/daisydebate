import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { getAssignedDebates } from '../../../features/judge/get-assigned';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { JudgeHub } from './judge-hub';
setupRitewayBun();
test('real Judge hub projects own stored states and empty waiting without synthetic assignments', () => {
  const assigned = getAssignedDebates([
    {
      roundId: 'r'.repeat(24),
      resolution: 'Cities should fund transit',
      status: 'active',
      outcome: null,
      ballotSubmitted: false,
      freezeRevision: 1,
    },
  ]);
  const view = renderAccessible(h(JudgeHub, { assigned }));
  const hrefs = view.all('link').map((link) => link.getAttribute('href'));
  const text = view.textContent();
  const found = [
    view.count('heading', undefined, { level: 1 }),
    hrefs.includes(`/judge/ballot/${'r'.repeat(24)}`),
    hrefs.includes(`/rounds/${'r'.repeat(24)}/room`),
    text.includes('The recorded transcript is frozen'),
    text.includes('Start judging'),
    text.includes('Your judge rating'),
    view.has('region', 'Assigned to you'),
  ];
  const empty = renderAccessible(
    h(JudgeHub, { assigned: getAssignedDebates([]) }),
  );
  assert({
    given: 'one actual assignment or no judge seats',
    should:
      'offer the real frozen ballot or truthful waiting, never a sample match/rating',
    actual: [
      ...found,
      empty.textContent().includes('No assigned Rounds'),
      empty.has('region', 'Assigned to you'),
    ],
    expected: [1, true, true, true, false, false, true, true, false],
  });
});

test('Judge links to the judging guides', () => {
  const empty = renderAccessible(
    h(JudgeHub, { assigned: getAssignedDebates([]) }),
  );
  assert({
    given: 'the Judge hub with no assignments',
    should: 'link to the judging guides beside Find a Room',
    actual: [
      empty.attribute('link', 'Judging guides', 'href'),
      empty.has('link', 'Find a Room'),
    ],
    expected: ['/guides/judging', true],
  });
});
