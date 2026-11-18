import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { join } from 'node:path';
import { routeExists } from '../../ui/test-support/route-exists';
import { helpTopics } from './topics';

const appDirectory = join(import.meta.dir, '../../app');
const topic = (id: string) => helpTopics.find((entry) => entry.id === id);

setupRitewayBun();

describe('helpTopics', () => {
  test('ids are unique and every topic points somewhere', () => {
    assert({
      given: 'the help topics',
      should: 'have unique ids, an answer and at least one local link',
      actual: [
        new Set(helpTopics.map((topic) => topic.id)).size === helpTopics.length,
        helpTopics.every(
          (topic) =>
            topic.answer.length > 0 &&
            topic.links.length > 0 &&
            topic.links.every((link) => link.href.startsWith('/')),
        ),
      ],
      expected: [true, true],
    });
  });

  test('the questions people asked', () => {
    assert({
      given: 'the help topics',
      should:
        'answer ratings, judges, teams, why Freestyle, leagues and why ranked rounds are recorded',
      actual: [
        'ratings',
        'judging',
        'teams',
        'why-freestyle',
        'run-your-league',
        'ranked-recorded',
      ].filter((id) => topic(id) === undefined),
      expected: [],
    });
  });

  test('every link reaches a page', () => {
    assert({
      given: 'every topic link, without its fragment',
      should: 'resolve to a page in the app router tree',
      actual: helpTopics
        .flatMap((entry) => entry.links)
        .map((link) => link.href.split('#')[0] as string)
        .filter((href) => !routeExists(appDirectory, href)),
      expected: [],
    });
  });

  test('recorded rounds stay within the waiver', () => {
    const answer = topic('ranked-recorded')?.answer ?? '';
    assert({
      given: 'the ranked content waiver, which promises no payment',
      should:
        'say there is no payment today and frame any revenue share as a future goal',
      actual: [
        answer.includes('There is no payment today'),
        answer.includes('a goal for a future program'),
        /\b(will|guarantee)\b/i.test(answer),
      ],
      expected: [true, true, false],
    });
  });
});
