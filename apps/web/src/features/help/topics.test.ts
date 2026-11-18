import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { helpTopics, visibleHelpTopics } from './topics';

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
});

test('the plans topic waits for /pricing', () => {
  const links = (open: boolean) =>
    visibleHelpTopics(open).flatMap((topic) =>
      topic.links.map((link) => link.href),
    );
  assert({
    given: '/pricing closed, then open',
    should: 'leave out the topic that links to it until it opens',
    actual: [
      links(false).includes('/pricing'),
      links(true).includes('/pricing'),
    ],
    expected: [false, true],
  });
  assert({
    given: '/pricing closed',
    should: 'keep every other topic',
    actual: visibleHelpTopics(false).length,
    expected: helpTopics.length - 1,
  });
});
