import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { helpTopics } from './topics';

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
