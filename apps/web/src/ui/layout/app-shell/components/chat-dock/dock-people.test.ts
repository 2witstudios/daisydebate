import { parseUsername } from '@daisy/auth';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { users } from '../../../../mock/users';
import { dockGroups, onlineNow } from './dock-people';

setupRitewayBun();

const sample = [
  { name: 'Alex Chen', presence: 'online' as const },
  { name: 'Sophia Lee', presence: 'in-debate' as const },
  { name: 'Priya Shah', presence: 'away' as const },
  { name: 'Gone Away', presence: 'offline' as const },
  { name: 'Daniel Kim', presence: 'online' as const },
];

describe('dockGroups', () => {
  test('grouped by what people are doing, debating first, offline left out', () => {
    assert({
      given: 'online, in-debate, away and offline people',
      should: 'list in a debate, then online, then away, and skip offline',
      actual: dockGroups(sample).map((group) => [
        group.label,
        group.people.map((person) => person.name),
      ]),
      expected: [
        ['In a debate', ['Sophia Lee']],
        ['Online', ['Alex Chen', 'Daniel Kim']],
        ['Away', ['Priya Shah']],
      ],
    });
  });

  test('what you can do with each', () => {
    const people = dockGroups(sample).flatMap((group) => group.people);
    assert({
      given: 'the people',
      should:
        'offer Watch for a debate, Challenge when online, nothing when away',
      actual: people.map((person) => person.action?.label ?? null),
      expected: ['Watch', 'Challenge', 'Challenge', null],
    });
  });

  test('profile links are valid usernames', () => {
    const hrefs = dockGroups(users).flatMap((group) =>
      group.people.map((person) => person.profileHref),
    );
    assert({
      given: 'every sample user',
      should: 'link to a profile whose handle is a valid username',
      actual: hrefs.every(
        (href) => parseUsername(href.replace('/profile/', '')).ok,
      ),
      expected: true,
    });
  });
});

describe('onlineNow', () => {
  test('counts those around, not away or offline', () => {
    assert({
      given: 'the sample people',
      should: 'count online and in-debate only',
      actual: onlineNow(sample),
      expected: 3,
    });
  });
});
