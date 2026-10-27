import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseBoardArgs, strayIssues } from './board-model';

setupRitewayBun();

describe('parseBoardArgs issue buckets', () => {
  const list = 'cy7vznqfbs8ikfwj1qu8xxnm';
  const firstLine = (argv: string[]) => {
    const parsed = parseBoardArgs(argv);
    return 'error' in parsed ? parsed.error.split('\n')[0] : parsed;
  };

  test('files an issue only into a named bucket', () => {
    assert({
      given:
        'an issue with no bucket, an issue with a list id, and a bucket on a non-issue',
      should: 'refuse each, naming the rule',
      actual: [
        firstLine(['create', '--issue', '--title', 'x']),
        firstLine([
          'create',
          list,
          '--issue',
          '--bucket',
          'Bugs',
          '--title',
          'x',
        ]),
        firstLine(['create', list, '--bucket', 'Bugs', '--title', 'x']),
      ],
      expected: [
        '--issue needs --bucket <name>: every issue lives in an Issues bucket',
        '--issue takes its list from --bucket, not a list id',
        '--bucket applies only to --issue',
      ],
    });
  });
});

describe('strayIssues', () => {
  test('finds issues filed directly under Issues', () => {
    assert({
      given:
        'the Issues list holding buckets, one stray issue and a stray decision-like title',
      should:
        'return only the ISSUE-n pages with their codes, however they are titled',
      actual: strayIssues([
        { title: 'Bugs', pageId: 'b' },
        { title: 'ISSUE-12 — Given a, should b', pageId: 'i12' },
        { title: 'Backlog', pageId: 'k' },
        { title: 'ISSUE-7: filed by hand', pageId: 'i7' },
      ]),
      expected: [
        {
          title: 'ISSUE-12 — Given a, should b',
          pageId: 'i12',
          code: 'ISSUE-12',
        },
        { title: 'ISSUE-7: filed by hand', pageId: 'i7', code: 'ISSUE-7' },
      ],
    });
  });
});
