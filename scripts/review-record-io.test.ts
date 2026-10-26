import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { DAISY_DRIVE, readRecords } from './review-record-io';
import { verifyReviewRecord } from './review-record';
import { pr, record } from './review-record.test-support';

setupRitewayBun();

const page = { ...record(), driveId: DAISY_DRIVE };
const id = page.id;

describe('review record transport boundary', () => {
  test('routes only explicitly local tokenless reads to full CLI details', async () => {
    const calls: unknown[] = [];
    const result = await readRecords([id], {
      localCli: true,
      env: {},
      cli: (args) => {
        calls.push(args);
        return JSON.stringify(page);
      },
    });
    assert({
      given: 'a local read without an API token',
      should:
        'read structured full details and reach the same approving verifier',
      actual: [
        calls,
        result.unreadable,
        verifyReviewRecord(pr, result.records).state,
      ],
      expected: [[['pages', 'read-details', id, '--json']], [], 'success'],
    });
  });

  test('keeps explicit token reads on HTTPS API with redirects refused', async () => {
    const calls: unknown[] = [];
    const result = await readRecords([id], {
      localCli: true,
      env: {
        PAGESPACE_TOKEN: 'test-token',
        PAGESPACE_API_URL: 'https://pagespace.ai',
      },
      cli: () => {
        throw new Error('CLI must not run');
      },
      fetch: async (url, init) => {
        calls.push([
          String(url),
          init?.redirect,
          new Headers(init?.headers).get('Authorization'),
        ]);
        return Response.json(page);
      },
    });
    assert({
      given: 'an explicit API token and an available local CLI',
      should: 'use only the configured bearer API',
      actual: [calls, result.unreadable],
      expected: [
        [
          [
            `https://pagespace.ai/api/pages/${id}`,
            'error',
            'Bearer test-token',
          ],
        ],
        [],
      ],
    });
  });

  test('refuses ambient CLI in CI and shared default reads', async () => {
    let calls = 0;
    const results = [];
    for (const options of [
      { localCli: true, env: { CI: 'true' } },
      { localCli: true, env: { GITHUB_ACTIONS: 'true' } },
      { env: {} },
    ]) {
      results.push(
        await readRecords([id], {
          ...options,
          cli: () => {
            calls++;
            return JSON.stringify(page);
          },
        }),
      );
    }
    assert({
      given: 'CI or no explicit local opt-in without a token',
      should: 'fail closed without CLI calls',
      actual: [calls, results],
      expected: [
        0,
        [
          { records: [], unreadable: [id] },
          { records: [], unreadable: [id] },
          { records: [], unreadable: [id] },
        ],
      ],
    });
  });

  test('rejects unsafe IDs and insecure API hosts before any transport call', async () => {
    let calls = 0;
    const results = [];
    for (const [requested, host] of [
      ['--token=secret', 'https://pagespace.ai'],
      ['../other', 'https://pagespace.ai'],
      [id, 'http://pagespace.ai'],
      [id, 'invalid-url'],
    ]) {
      results.push(
        await readRecords([requested!], {
          localCli: true,
          env: { PAGESPACE_TOKEN: 'test-token', PAGESPACE_API_URL: host },
          cli: () => {
            calls++;
            return JSON.stringify(page);
          },
          fetch: async () => {
            calls++;
            return Response.json(page);
          },
        }),
      );
    }
    assert({
      given: 'unsafe positional IDs or a bearer destination without HTTPS',
      should: 'refuse before I/O',
      actual: [
        calls,
        results.every(
          (result) =>
            result.records.length === 0 && result.unreadable.length === 1,
        ),
      ],
      expected: [0, true],
    });
  });

  test('refuses malformed, wrong-scope, incomplete and unavailable CLI details', async () => {
    const outputs = [
      'null',
      '[]',
      '{',
      JSON.stringify({ ...page, id: 'other' }),
      JSON.stringify({ ...page, driveId: 'other' }),
      JSON.stringify({ ...page, content: 4 }),
      JSON.stringify({ id, driveId: DAISY_DRIVE }),
      'x'.repeat(1_048_577),
      undefined,
    ];
    const results = [];
    for (const stdout of outputs) {
      results.push(
        await readRecords([id], {
          localCli: true,
          env: {},
          cli: () => {
            if (stdout === undefined)
              throw new Error('absent, nonzero exit, timeout or output limit');
            return stdout;
          },
        }),
      );
    }
    assert({
      given: 'untrusted CLI output or subprocess failure',
      should: 'mark every record unreadable',
      actual: results.every(
        (result) => result.records.length === 0 && result.unreadable[0] === id,
      ),
      expected: true,
    });
  });

  test('treats each subprocess failure as unreadable without exposing errors', async () => {
    const results = [];
    for (const code of ['ENOENT', 'EXIT_1', 'ETIMEDOUT', 'ENOBUFS']) {
      results.push(
        await readRecords([id], {
          localCli: true,
          env: {},
          cli: () => {
            throw Object.assign(new Error('private subprocess diagnostic'), {
              code,
            });
          },
        }),
      );
    }
    assert({
      given: 'missing CLI, failed exit, timeout or maximum output failure',
      should: 'return only IDs and no subprocess diagnostics',
      actual: results,
      expected: Array.from({ length: 4 }, () => ({
        records: [],
        unreadable: [id],
      })),
    });
  });

  test('never retries failed API reads through CLI', async () => {
    let cliCalls = 0;
    const results = [];
    for (const response of [
      new Response('', { status: 403 }),
      new Response('{'),
      Response.json({ ...page, id: 'other' }),
      Response.json({ ...page, driveId: 'other' }),
      undefined,
    ]) {
      results.push(
        await readRecords([id], {
          localCli: true,
          env: { PAGESPACE_TOKEN: 'test-token' },
          cli: () => {
            cliCalls++;
            return JSON.stringify(page);
          },
          fetch: async () => {
            if (!response) throw new Error('unavailable');
            return response;
          },
        }),
      );
    }
    assert({
      given: 'HTTP failure, malformed data, wrong identity or unreadable API',
      should: 'refuse without credential fallback',
      actual: [
        cliCalls,
        results.every((result) => result.unreadable[0] === id),
      ],
      expected: [0, true],
    });
  });

  test('retains exact-head, builder and reviewer independence refusals', async () => {
    const states = [];
    for (const candidate of [
      record({
        title: `Review ${'b'.repeat(40)}`,
        candidate: `Candidate: ${'b'.repeat(40)} · PR #57 · Builder: ag-builder · Reviewer: ag-reviewer`,
      }),
      record({
        candidate: `Candidate: ${pr.headSha} · PR #57 · Builder: other · Reviewer: ag-reviewer`,
      }),
      record({
        candidate: `Candidate: ${pr.headSha} · PR #57 · Builder: ag-builder · Reviewer: ag-builder`,
      }),
      {
        ...record({ verdict: 'BRANCH FEEDBACK' }),
        content: `Review stage: branch\n${record({ verdict: 'BRANCH FEEDBACK' }).content}`,
      },
    ]) {
      const result = await readRecords([id], {
        localCli: true,
        env: {},
        cli: () => JSON.stringify({ ...candidate, driveId: DAISY_DRIVE }),
      });
      states.push(verifyReviewRecord(pr, result.records).state);
    }
    assert({
      given: 'CLI-fetched stale, mismatched, self-reviewed or feedback records',
      should: 'retain all acceptance refusals',
      actual: states,
      expected: ['pending', 'failure', 'failure', 'pending'],
    });
  });
});
