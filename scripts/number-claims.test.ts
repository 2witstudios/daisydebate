import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  claimsOf,
  collisionProblems,
  listOpenPrs,
  nextFree,
  numberCollisionProblems,
  type OpenPr,
} from './number-claims';

setupRitewayBun();

const mainFiles = [
  'docs/decisions/0033-presence-and-adjudication.md',
  'docs/decisions/README.md',
  'packages/db/migrations/0004_realtime-role.sql',
  'packages/db/migrations/meta/_journal.json',
];

const openPrs: readonly OpenPr[] = [
  {
    number: 50,
    branch: 'pu/par-2-slots',
    files: ['docs/decisions/0034-shared-stack-slots.md'],
  },
  {
    number: 57,
    branch: 'pu/grd-6-autonomy',
    files: [
      'docs/decisions/0034-autonomy-guardrails.md',
      'packages/db/migrations/0005_x.sql',
    ],
  },
  {
    number: 58,
    branch: 'pu/other',
    files: ['packages/db/migrations/0005_y.sql'],
  },
];

describe('claimsOf', () => {
  test('reads ADR and migration numbers from paths', () => {
    assert({
      given: 'decision records, migrations and unrelated files',
      should: 'return one claim per numbered record',
      actual: claimsOf(mainFiles),
      expected: [
        {
          kind: 'ADR',
          number: '0033',
          file: 'docs/decisions/0033-presence-and-adjudication.md',
        },
        {
          kind: 'migration',
          number: '0004',
          file: 'packages/db/migrations/0004_realtime-role.sql',
        },
      ],
    });
  });
});

describe('nextFree', () => {
  test('returns the numbers free across main and every open PR', () => {
    const claims = [
      ...claimsOf(mainFiles),
      ...openPrs.flatMap((pr) => claimsOf(pr.files)),
    ];
    assert({
      given: 'ADR 0034 and migration 0005 claimed by open PRs',
      should: 'return ADR 0035 and migration 0006',
      actual: [nextFree(claims, 'ADR'), nextFree(claims, 'migration')],
      expected: ['0035', '0006'],
    });
  });
});

describe('collisionProblems', () => {
  test('fails the later PR that reuses a number an earlier open PR holds', () => {
    assert({
      given:
        'PR #57 claiming ADR 0034 held by #50 and migration 0005 also in #58',
      should: 'report the ADR clash with the earlier PR only',
      actual: collisionProblems(openPrs, 57),
      expected: [
        'numbers: ADR 0034 (docs/decisions/0034-autonomy-guardrails.md) is already claimed by open PR #50 (docs/decisions/0034-shared-stack-slots.md); run bun adr:next',
      ],
    });
  });

  test('reports clashes for an unpublished branch against every open PR', () => {
    assert({
      given: 'a local branch with no PR adding migration 0005',
      should: 'report both open PRs that hold 0005',
      actual: collisionProblems(openPrs, undefined, [
        'packages/db/migrations/0005_z.sql',
      ]).length,
      expected: 2,
    });
  });

  test('passes a branch whose numbers are free', () => {
    assert({
      given: 'PR #58 as the earliest holder of nothing contested',
      should: 'report nothing for PR #50',
      actual: collisionProblems(openPrs, 50),
      expected: [],
    });
  });

  test('does not count a stacked PR that carries the same file', () => {
    const stacked: readonly OpenPr[] = [
      {
        number: 61,
        branch: 'pu/grd-6-1-3-loops-spawn',
        files: ['docs/decisions/0035-autonomy-guardrails.md'],
      },
      {
        number: 63,
        branch: 'pu/grd-6-1-5-rules-review',
        files: ['docs/decisions/0035-autonomy-guardrails.md'],
      },
    ];
    assert({
      given: 'a later PR stacked on an earlier one, both showing ADR 0035',
      should: 'report no clash: it is the same record, not a second claim',
      actual: collisionProblems(stacked, 63),
      expected: [],
    });
  });
});

describe('numberCollisionProblems', () => {
  const prList = JSON.stringify([
    {
      number: 50,
      headRefName: 'pu/par-2-slots',
      files: [{ path: 'docs/decisions/0034-shared-stack-slots.md' }],
    },
  ]);
  const fake = (failing: string) => (args: readonly string[]) => {
    const line = args.join(' ');
    if (line.startsWith(failing)) return { code: 1, stdout: '' };
    if (line.startsWith('gh pr list')) return { code: 0, stdout: prList };
    if (line.startsWith('git rev-parse'))
      return { code: 0, stdout: 'pu/new\n' };
    return {
      code: 0,
      stdout: 'docs/decisions/0034-new-thing.md\n',
    };
  };

  test('fails closed when gh or git cannot be read', () => {
    assert({
      given: 'gh pr list failing, then git diff against origin/main failing',
      should: 'report each as a problem instead of passing',
      actual: [
        numberCollisionProblems(fake('gh pr list'), {}),
        numberCollisionProblems(fake('git diff'), {}),
      ],
      expected: [
        [
          'numbers: cannot list open PRs with gh (authenticate gh, or set GH_TOKEN in CI)',
        ],
        [
          'numbers: cannot diff this branch against origin/main (git fetch origin, then retry)',
        ],
      ],
    });
  });

  test('reads open PRs and checks an unpublished branch against them', () => {
    assert({
      given: 'an open PR holding ADR 0034 and a new branch adding 0034',
      should: 'list the PR and report the clash',
      actual: [
        listOpenPrs(fake('none')).map((pr) => pr.number),
        numberCollisionProblems(fake('none'), {}).length,
      ],
      expected: [[50], 1],
    });
  });
});
