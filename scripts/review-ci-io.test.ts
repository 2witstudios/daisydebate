// The CI-evidence edge: which runs a record cites, and how a run read
// from the Actions API becomes the facts the verifier checks.
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { citedRunIds } from './review-record';
import { ciRunFromApi, readCiEvidence } from './review-record-io';
import { record, sha } from './review-record.test-support';
import {
  ciRun,
  citing,
  integration,
  repository,
} from './review-ci.test-support';

setupRitewayBun();

describe('citedRunIds', () => {
  test('collects each cited run once, only from Gates run, never from a bad URL', () => {
    assert({
      given:
        'two records citing run 101, one also citing a non-run URL, and a citation quoted under Findings',
      should: 'return the run id once',
      actual: citedRunIds([
        citing(integration()),
        record({
          gates: [
            integration(),
            integration('https://example.com/runs/9'),
          ].join('\n'),
          findings: integration(
            `https://github.com/${repository}/actions/runs/303`,
          ),
        }),
      ]),
      expected: ['101'],
    });
  });
});

describe('ciRunFromApi', () => {
  const apiRun = {
    id: 101,
    head_sha: sha,
    event: 'pull_request',
    path: '.github/workflows/ci.yml',
    head_branch: 'pu/builder',
    pull_requests: [
      { number: 57, base: { ref: 'main' } },
      { number: 'x', base: { ref: 'main' } },
    ],
    repository: { full_name: repository },
    head_repository: { full_name: repository },
  };
  const jobPages = [
    {
      jobs: [
        {
          name: 'Infrastructure contracts',
          status: 'completed',
          conclusion: 'success',
        },
      ],
    },
  ];

  test('reads a documented run and its paginated jobs', () => {
    assert({
      given: 'a run and one page of its latest jobs',
      should: 'return the run facts the verifier checks',
      actual: ciRunFromApi('101', apiRun, jobPages),
      expected: ciRun({
        jobs: [
          {
            name: 'Infrastructure contracts',
            status: 'completed',
            conclusion: 'success',
          },
        ],
      }),
    });
  });

  test('refuses responses that are not the documented shape', () => {
    assert({
      given:
        'another run id, a run without a repository, and a jobs page without jobs',
      should: 'return undefined for each',
      actual: [
        ciRunFromApi('102', apiRun, jobPages),
        ciRunFromApi('101', { ...apiRun, repository: null }, jobPages),
        ciRunFromApi('101', apiRun, [{ total_count: 1 }]),
      ],
      expected: [undefined, undefined, undefined],
    });
  });
});

describe('readCiEvidence', () => {
  test('reads each cited run of this repository and leaves failed reads out', () => {
    const calls: (readonly string[])[] = [];
    const read = readCiEvidence(
      (args) => {
        calls.push(args);
        const path = args.at(-1) ?? '';
        if (path.includes('/runs/404')) return { code: 1, stdout: '' };
        return {
          code: 0,
          stdout: JSON.stringify(
            path.includes('/jobs')
              ? [{ jobs: [] }]
              : {
                  id: 101,
                  head_sha: sha,
                  event: 'push',
                  path: '.github/workflows/ci.yml',
                  repository: { full_name: repository },
                  head_repository: { full_name: repository },
                },
          ),
        };
      },
      repository,
      ['101', '404'],
    );
    assert({
      given: 'a readable run and one the API refuses',
      should:
        'return only the readable run, reading its latest jobs on every page',
      actual: [read.runs.map((run) => run.id), calls[1]],
      expected: [
        ['101'],
        [
          'api',
          '--paginate',
          '--slurp',
          `repos/${repository}/actions/runs/101/jobs?filter=latest&per_page=100`,
        ],
      ],
    });
  });
});
