import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');

/**
 * AUTH-6.3 AC4: prove that four targeted safeguards actually gate the
 * behavior their tests claim, by sabotaging each one, showing its test
 * fails, restoring the real source, and showing the test passes again. Each
 * control mutates exactly one repository-owned file with a single, exact
 * string replacement (never `sed`/regex) so the sabotage and its restore are
 * a reviewable diff, and only pure, service-free unit tests are used so the
 * whole run needs no live Postgres/Redis.
 */
export type Control = {
  readonly name: string;
  readonly file: string;
  readonly find: string;
  readonly replace: string;
  readonly testFile: string;
};

const controls: readonly Control[] = [
  {
    name: 'protected-route session guard',
    file: 'apps/web/src/features/access/decision.ts',
    find: `  if (identity.state === 'anonymous')\n    return redirectTo(signInHref(returnDestination(path)));\n`,
    replace: '',
    testFile: 'apps/web/src/features/access/decision.test.ts',
  },
  {
    name: 'atomic rate limiting replaced with an always-allow adapter',
    file: 'apps/web/src/features/auth/rate-limit.ts',
    find: `export const readDecision = (decision: unknown) => {
  if (typeof decision !== 'object' || decision === null)
    throw new TypeError('Malformed limiter decision');
  const allowed: unknown = Reflect.get(decision, 'allowed');
  if (typeof allowed !== 'boolean')
    throw new TypeError('Malformed limiter decision');
  const retryAfterSeconds: unknown = Reflect.get(decision, 'retryAfterSeconds');
  return { allowed, retryAfterSeconds };
};`,
    replace: `export const readDecision = (_decision: unknown) => {
  // SABOTAGE: an always-allow adapter, ignoring the real limiter's verdict.
  return { allowed: true, retryAfterSeconds: 0 };
};`,
    testFile: 'apps/web/src/features/auth/rate-limit.test.ts',
  },
  {
    name: 'same-origin (CSRF) enforcement on state-changing requests',
    file: 'apps/web/src/server/http.ts',
    find: `export function requireSameOrigin(request: Request, origin: string) {
  const claimed = request.headers.get('origin');
  if (claimed === new URL(origin).origin) return;
  if (
    claimed === 'null' &&
    request.headers.get('sec-fetch-site') === 'same-origin'
  )
    return;
  throw createAppError('AUTHORIZATION');
}`,
    replace: `export function requireSameOrigin(_request: Request, _origin: string) {
  // SABOTAGE: never refuses a forged or cross-site Origin.
  return;
}`,
    testFile: 'apps/web/src/server/same-origin-form.test.ts',
  },
];

/**
 * The two remaining named sabotages from AUTH-6.3 AC4 (passkey ownership
 * validation, permitting replayed verification tokens) are enforced entirely
 * inside the pinned, vendored `@better-auth/passkey` and `better-auth`
 * magic-link plugins (confirmed by reading their compiled output under
 * node_modules): no repository-owned source implements or could sabotage
 * that check. node_modules is untracked, so a "sabotage then git restore"
 * cycle there is not a reviewable diff and mutating a third-party dependency
 * to prove a point is itself the kind of production-safeguard weakening the
 * builder contract forbids. Those two guarantees are instead proven end to
 * end against the real vendored behavior by existing real-service
 * integration tests: apps/web/integration/auth-passkey-management.integration.ts
 * ("another user's credential id is refused for rename and removal") and
 * apps/web/integration/auth-magic-link.integration.ts ("a replay of a
 * consumed token fails with no cookie, extra session or duplicate user").
 */
const blockedControls = [
  {
    name: 'bypassing passkey ownership validation',
    reason:
      'enforced inside the vendored @better-auth/passkey plugin (node_modules, untracked); proven instead by apps/web/integration/auth-passkey-management.integration.ts',
  },
  {
    name: 'permitting replayed verification tokens',
    reason:
      'enforced inside the vendored better-auth magic-link plugin storeToken/verify path (node_modules, untracked); proven instead by apps/web/integration/auth-magic-link.integration.ts',
  },
] as const;

type RunResult = {
  readonly exitCode: number;
  readonly output: string;
};

type ControlResult = {
  readonly name: string;
  readonly file: string;
  readonly testFile: string;
  readonly diff: string;
  readonly red: RunResult;
  readonly green: RunResult;
  readonly ok: boolean;
};

type NegativeControlsReport = {
  readonly ok: boolean;
  readonly controls: readonly ControlResult[];
  readonly blocked: readonly { name: string; reason: string }[];
};

/** Fails loudly rather than silently no-op'ing if the source has drifted. */
export function applyMutation(content: string, control: Control): string {
  const occurrences = content.split(control.find).length - 1;
  if (occurrences !== 1)
    throw new Error(
      `${control.name}: expected exactly one occurrence of the target text in ${control.file}, found ${occurrences}. The source has drifted; update the control.`,
    );
  return content.replace(control.find, control.replace);
}

export function formatReport(report: NegativeControlsReport): string {
  const lines: string[] = [
    `# Negative controls — AUTH-6.3 AC4`,
    '',
    `Overall: ${report.ok ? 'PASS' : 'FAIL'}`,
    '',
  ];
  for (const result of report.controls) {
    lines.push(
      `## ${result.name}`,
      '',
      `File: \`${result.file}\``,
      `Test: \`${result.testFile}\``,
      `Result: ${result.ok ? 'PASS (red then green, as required)' : 'FAIL'}`,
      '',
      '```diff',
      result.diff.trim(),
      '```',
      '',
      `Sabotaged run (expected FAIL) — exit ${result.red.exitCode}:`,
      '```',
      result.red.output.trim(),
      '```',
      '',
      `Restored run (expected PASS) — exit ${result.green.exitCode}:`,
      '```',
      result.green.output.trim(),
      '```',
      '',
    );
  }
  if (report.blocked.length > 0) {
    lines.push('## Not sabotaged (vendor-enforced, see reasons)', '');
    for (const blocked of report.blocked)
      lines.push(`- **${blocked.name}**: ${blocked.reason}`);
    lines.push('');
  }
  return lines.join('\n');
}

function runGit(args: readonly string[]): RunResult {
  const result = Bun.spawnSync(['git', ...args], { cwd: root });
  return {
    exitCode: result.exitCode,
    output: `${result.stdout}${result.stderr}`,
  };
}

function runTest(testFile: string): RunResult {
  const result = Bun.spawnSync(['bun', 'test', testFile], { cwd: root });
  return {
    exitCode: result.exitCode,
    output: `${result.stdout}${result.stderr}`,
  };
}

function assertCleanTree(): void {
  const status = runGit(['status', '--porcelain']);
  if (status.output.trim() !== '')
    throw new Error(
      'The working tree is not clean. Negative controls sabotage and restore real source files via `git checkout --`; refusing to run against uncommitted work:\n' +
        status.output,
    );
}

async function runControl(control: Control): Promise<ControlResult> {
  const path = resolve(root, control.file);
  const original = readFileSync(path, 'utf8');
  const mutated = applyMutation(original, control);
  writeFileSync(path, mutated);
  const diff = runGit(['diff', '--', control.file]).output;
  const red = runTest(control.testFile);
  // Restore via git, never by re-writing the buffer: proves the working
  // tree is byte-identical to the committed source afterward.
  const restore = runGit(['checkout', '--', control.file]);
  if (restore.exitCode !== 0)
    throw new Error(`Failed to restore ${control.file}: ${restore.output}`);
  const clean = runGit(['diff', '--', control.file]).output.trim();
  if (clean !== '') throw new Error(`${control.file} did not restore cleanly`);
  const green = runTest(control.testFile);
  return {
    name: control.name,
    file: control.file,
    testFile: control.testFile,
    diff,
    red,
    green,
    // The control is proven only if sabotage genuinely broke the test AND
    // the restored source genuinely passes it again.
    ok: red.exitCode !== 0 && green.exitCode === 0,
  };
}

async function runAllControls(): Promise<NegativeControlsReport> {
  assertCleanTree();
  const results: ControlResult[] = [];
  for (const control of controls) results.push(await runControl(control));
  assertCleanTree();
  return {
    ok: results.every((result) => result.ok),
    controls: results,
    blocked: blockedControls,
  };
}

if (import.meta.main) {
  const report = await runAllControls();
  const outDir = resolve(root, 'test-results');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    resolve(outDir, 'negative-controls-report.json'),
    JSON.stringify(report, null, 2),
  );
  const markdown = formatReport(report);
  writeFileSync(resolve(outDir, 'negative-controls-report.md'), markdown);
  process.stdout.write(markdown);
  process.exitCode = report.ok ? 0 : 1;
}
