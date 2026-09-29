import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readFileSync } from 'node:fs';
import { findRuntimeRoleGateProblem } from './verify-deploy-config';

setupRitewayBun();

// The start.ts runtime-role gate (ISSUE-39): start-up runs only through
// startProductionServer (ISSUE-193), with exactly one @daisy/db refusal
// nothing can duplicate, override or replace (ISSUE-206).
const realStart = readFileSync('apps/web/src/server/start.ts', 'utf8');

describe('findRuntimeRoleGateProblem (ISSUE-39, ISSUE-193)', () => {
  const refusal =
    "  refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web'),\n";
  const start = (body: string, awaitStarted = 'await started;\n') =>
    `const { server, started } = startProductionServer({\n  app,\n  nextApp,\n${body}  port,\n  host: '0.0.0.0',\n});\n${awaitStarted}`;
  const missing =
    "start.ts does not start through startProductionServer with refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web') and await started";

  test('the committed start.ts starts only through startProductionServer', () => {
    assert({
      given: 'the real start.ts',
      should: 'report no problem',
      actual: findRuntimeRoleGateProblem(realStart),
      expected: null,
    });
  });

  test('a start.ts without the role refusal, with it commented out, or not awaiting start-up', () => {
    assert({
      given:
        'no refuseRole, a commented refuseRole, and a start-up whose result is never awaited',
      should: 'report each as missing its gated start-up',
      actual: [
        start(''),
        start(`  // ${refusal.trim()}\n`),
        start(refusal, ''),
      ].map(findRuntimeRoleGateProblem),
      expected: [missing, missing, missing],
    });
  });

  test('a start.ts that composes, prepares or listens outside startProductionServer', () => {
    assert({
      given:
        "the review's mutation (Next's handler handed to createProductionServer), a direct nextApp.prepare(), and a direct server.listen",
      should: 'report each as bypassing the start-up gate',
      actual: [
        `${start(refusal)}const bypass = createProductionServer({ app, handle: nextApp.getRequestHandler(), readRouteTable });\n`,
        `await nextApp.prepare();\n${start(refusal)}`,
        `${start(refusal)}server.listen(port, '0.0.0.0');\n`,
      ].map(findRuntimeRoleGateProblem),
      expected: [
        'start.ts bypasses the start-up gate with createProductionServer(; start only through startProductionServer (ISSUE-193)',
        'start.ts bypasses the start-up gate with nextApp.prepare(; start only through startProductionServer (ISSUE-193)',
        'start.ts bypasses the start-up gate with .listen(; start only through startProductionServer (ISSUE-193)',
      ],
    });
  });
});

describe('findRuntimeRoleGateProblem refuses a disabled refusal (ISSUE-206)', () => {
  const refusalLine =
    "  refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web'),\n";
  const importLine = "import { refuseSchemaAlteringRole } from '@daisy/db';\n";
  const withRefusal = (after: string) =>
    realStart.replace(refusalLine, `${refusalLine}${after}`);
  const oneCall =
    'start.ts must call startProductionServer exactly once; a second call starts a server the checked refusal does not guard (ISSUE-206)';
  const overridden =
    "start.ts's startProductionServer call sets refuseRole more than once or spreads other options into it; only refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web') may set it (ISSUE-206)";
  const notFromDb =
    'start.ts must import refuseSchemaAlteringRole from @daisy/db and use it only as the refuseRole (ISSUE-206)';

  test('the committed start.ts still reports no problem', () => {
    assert({
      given: 'the real start.ts',
      should: 'report no problem',
      actual: findRuntimeRoleGateProblem(realStart),
      expected: null,
    });
  });

  test("the review's shape: a second startProductionServer call with a no-op refuseRole", () => {
    assert({
      given:
        'the committed call kept and a second startProductionServer({ ..., refuseRole: async () => {} }) added',
      should: 'report the second call',
      actual: findRuntimeRoleGateProblem(
        `${realStart}const bypass = startProductionServer({\n  app,\n  nextApp,\n  refuseRole: async () => {},\n  readRouteTable: () => null,\n  port: port + 1,\n  host: '0.0.0.0',\n});\nawait bypass.started;\n`,
      ),
      expected: oneCall,
    });
  });

  test("the review's shape: a later spread or refuseRole key that overrides the refusal", () => {
    assert({
      given:
        'a spread of a no-op refuseRole, a spread of an options object, and a second refuseRole key, each after the committed refusal',
      should: 'report each as overriding the refusal',
      actual: [
        withRefusal('  ...{ refuseRole: async () => {} },\n'),
        withRefusal('  ...overrides,\n'),
        withRefusal('  refuseRole: async () => {},\n'),
      ].map(findRuntimeRoleGateProblem),
      expected: [overridden, overridden, overridden],
    });
  });

  test('a no-op refuseSchemaAlteringRole that shadows or replaces the @daisy/db one', () => {
    assert({
      given:
        'the import swapped for a local no-op, the import pointed at another module, and a local no-op declared beside the import',
      should: 'report each as not refusing through @daisy/db',
      actual: [
        realStart.replace(
          importLine,
          'const refuseSchemaAlteringRole = async (..._: unknown[]) => {};\n',
        ),
        realStart.replace(
          importLine,
          "import { refuseSchemaAlteringRole } from './no-op';\n",
        ),
        realStart
          .replace(
            'const { server, started } = startProductionServer({',
            'const noOp = async () => {};\nconst { server, started } = startProductionServer({',
          )
          .replace(
            refusalLine,
            "  refuseRole: () => noOp() ?? refuseSchemaAlteringRole(app, 'daisy_web'),\n",
          ),
      ].map(findRuntimeRoleGateProblem),
      expected: [
        notFromDb,
        notFromDb,
        "start.ts does not start through startProductionServer with refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web') and await started",
      ],
    });
  });
});
