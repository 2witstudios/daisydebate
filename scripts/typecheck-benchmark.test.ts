import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  configsForScript,
  compilerArgs,
  checkedCandidate,
  sameDiagnostics,
  parseMeasurement,
} from './typecheck-benchmark';

setupRitewayBun();

describe('typecheck benchmark evidence', () => {
  test('includes production and test projects behind task wrappers', () => {
    assert({
      given: 'a workspace task with a separate test config',
      should: 'measure both unchanged compiler projects',
      actual: configsForScript(
        'packages/protocol',
        'tsc --noEmit && tsc --noEmit -p tsconfig.test.json',
      ),
      expected: [
        'packages/protocol/tsconfig.json',
        'packages/protocol/tsconfig.test.json',
      ],
    });
    assert({
      given: 'the Next typegen and heavy-queue wrapper',
      should: 'select the web project without replacing typegen',
      actual: configsForScript(
        'apps/web',
        "bun ../../scripts/heavy.ts sh -c 'next typegen && tsc --noEmit'",
      ),
      expected: ['apps/web/tsconfig.json'],
    });
    assert({
      given: 'the admin app behind the same typegen and heavy-queue wrapper',
      should: 'select the admin project without replacing typegen',
      actual: configsForScript(
        'apps/admin',
        "bun ../../scripts/heavy.ts sh -c 'next typegen && tsgo --noEmit'",
      ),
      expected: ['apps/admin/tsconfig.json'],
    });
  });
  test('isolates compiler incremental state for generated Next types', () => {
    assert({
      given: 'web negative and timing controls from different engines',
      should:
        'use private incremental metadata without changing typechecking options',
      actual: compilerArgs(
        'apps/web/tsconfig.json',
        '/tmp/evidence/native.tsbuildinfo',
      ),
      expected: [
        '--noEmit',
        '--pretty',
        'false',
        '-p',
        'apps/web/tsconfig.json',
        '--tsBuildInfoFile',
        '/tmp/evidence/native.tsbuildinfo',
      ],
    });
    assert({
      given: 'the admin app, the other incremental Next project',
      should: 'keep its incremental metadata private to the benchmark too',
      actual: compilerArgs(
        'apps/admin/tsconfig.json',
        '/tmp/evidence/native.tsbuildinfo',
      ).slice(-2),
      expected: ['--tsBuildInfoFile', '/tmp/evidence/native.tsbuildinfo'],
    });
    assert({
      given: 'a project without incremental state',
      should: 'pass no build-info override',
      actual: compilerArgs(
        'packages/db/tsconfig.json',
        '/tmp/evidence/native.tsbuildinfo',
      ).includes('--tsBuildInfoFile'),
      expected: false,
    });
  });
  test('attests the checked-out source instead of the GitHub merge ref', () => {
    assert({
      given: 'a head checkout matching the requested candidate',
      should: 'record that exact source revision',
      actual: checkedCandidate('abc123\n', 'abc123'),
      expected: 'abc123',
    });
    let error = '';
    try {
      checkedCandidate('head', 'merge-ref');
    } catch (cause) {
      error = (cause as Error).message;
    }
    assert({
      given: 'a checkout different from the requested candidate',
      should: 'refuse misleading evidence',
      actual: error,
      expected: 'Benchmark checkout does not match requested candidate',
    });
  });
  test('compares diagnostics without hiding changed codes, locations or text', () => {
    const diagnostic =
      'src/a.ts(1,7): error TS2322: Type string is not assignable to number.';
    for (const [other, equivalent] of [
      [`${diagnostic}\r\n`, true],
      [diagnostic.replace('2322', '2345'), false],
      [diagnostic.replace('(1,7)', '(2,7)'), false],
      [diagnostic.replace('string', 'boolean'), false],
      ['', false],
    ] as const) {
      assert({
        given: `compiler output ${JSON.stringify(other)}`,
        should: 'preserve every diagnostic distinction',
        actual: sameDiagnostics(diagnostic, other),
        expected: equivalent,
      });
    }
  });
  test('keeps time and peak RSS units explicit even on compiler failure', () => {
    assert({
      given: 'GNU time output after a rejected program',
      should: 'retain seconds, KiB and exit status',
      actual: parseMeasurement(
        'Command exited with non-zero status 2\n1.25\t123456\t2\n',
      ),
      expected: { seconds: 1.25, peakRssKiB: 123456, exitCode: 2 },
    });
  });
});
