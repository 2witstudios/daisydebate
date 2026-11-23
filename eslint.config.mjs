import { clientEdgeRules } from './eslint.config-client-edge.mjs';
import { hostTimeRules } from './eslint.config-host-time.mjs';
import { clockDigestRules } from './eslint.config-clock-digest.mjs';
import { requestPathRules } from './eslint.config-request-path.mjs';
import js from '@eslint/js';
import ts from 'typescript';
import tseslint from 'typescript-eslint';
import nextVitals from 'eslint-config-next/core-web-vitals';
import betterTailwind from 'eslint-plugin-better-tailwindcss';
import { getDefaultSelectors } from 'eslint-plugin-better-tailwindcss/defaults';

// The styling gate checks JSX attributes. Type information distinguishes a
// URL variable from a callable React action, which supplies its own POST.
const formActionPlugin = {
  rules: {
    'require-callable-action': {
      meta: {
        messages: {
          method:
            'Use method="post" for a form address. An omitted method requires a callable React action (ADR 0114).',
        },
      },
      create(context) {
        const { program, esTreeNodeToTSNodeMap } =
          context.sourceCode.parserServices;
        const checker = program.getTypeChecker();
        return {
          JSXOpeningElement(node) {
            if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'form')
              return;
            const named = (name) =>
              node.attributes.find(
                (attribute) =>
                  attribute.type === 'JSXAttribute' &&
                  attribute.name.type === 'JSXIdentifier' &&
                  attribute.name.name === name,
              );
            if (named('method')) return;
            const value = named('action')?.value;
            if (
              value?.type !== 'JSXExpressionContainer' ||
              value.expression.type === 'JSXEmptyExpression'
            )
              return;
            const expression = esTreeNodeToTSNodeMap.get(value.expression);
            const type = checker.getTypeAtLocation(expression);
            const members = type.isUnion() ? type.types : [type];
            if (
              members.some((member) => member.getCallSignatures().length === 0)
            )
              context.report({ node: value, messageId: 'method' });
          },
        };
      },
    },
  },
};

/**
 * Shared between the repo-wide `no-restricted-syntax` entry and the
 * ambient-time exemption below, so the two copies can't drift: the engineering
 * rules' explicit-exports rule applies to every workspace source file, with no
 * exception.
 */
const exportStarRestriction = {
  selector: 'ExportAllDeclaration',
  message:
    'Use named re-exports, not `export *` (docs/architecture/rules.md: explicit exports, no barrels).',
};

/**
 * ISSUE-11: an expected failure names what it expects. A bare `.toThrow()`
 * passes for any error, including a typo's TypeError; name the message,
 * pattern or class, or use `assertRejects` from `@daisy/errors/testing`.
 * `.not.toThrow()` stays: with no argument it is the strict form.
 * Every `no-restricted-syntax` list below carries it, as it does the
 * export-star ban.
 */
const bareToThrowRestriction = {
  selector:
    'CallExpression[callee.property.name=/^toThrow(Error)?$/][arguments.length=0]:not([callee.object.property.name="not"])',
  message:
    'Name the expected error (message, pattern or class) or use assertRejects from @daisy/errors/testing.',
};

/**
 * ISSUE-252: a Bun.serve with no hostname binds the wildcard address, and on
 * macOS another process may hold the same port on 127.0.0.1; requests to
 * 127.0.0.1 then reach that process instead (an Ollama or GitHub listener
 * answered a probe test's request). Binding 127.0.0.1 explicitly makes the
 * kernel refuse or avoid the taken port. Carried by every list, like the
 * two above.
 */
const bunCallee =
  ":matches([callee.object.name='Bun'], [callee.object.object.name='globalThis'][callee.object.property.name='Bun'])";
// Every spelling of the wildcard address: IPv4's all-zero forms ('0',
// '0.0.0.0'), IPv6's (only zeros and colons, bracketed or not: '::', '::0',
// '::0000', '0:0:0:0:0:0:0:0', '[::]'), the IPv4-mapped '::ffff:0.0.0.0',
// and the empty string (ISSUE-278, ISSUE-283, ISSUE-286). Loopback ('::1',
// '127.0.0.1', '::ffff:127.0.0.1') has a non-zero digit.
const wildcardAddress =
  '/^(0+(\\.0+){0,3}|\\[?[0:]*:[0:]*\\]?|\\[?[0:]*:[fF]{4}:0+(\\.0+){3}\\]?|)$/';
const bindMessage =
  "Bind the server's address (hostname or host: '127.0.0.1'): a wildcard bind can share its port with another process's loopback listener.";
/**
 * ISSUE-254 closes the routes the first selector missed: a hostname nested
 * in the handler rather than the options, an explicit wildcard address,
 * globalThis.Bun, a destructured serve or listen, Bun.listen, and a node
 * server's listen() with no host. ISSUE-278, ISSUE-283 and ISSUE-286 add
 * serve or listen imported from 'bun', Bun under another name (an alias,
 * or 'bun' imported whole, by default name or dynamically), hostname:
 * undefined and every wildcard spelling. Production's listen(port, host, …)
 * and a Postgres LISTEN (a string channel) stay clean.
 */
const unboundServerRestrictions = [
  `CallExpression[callee.property.name=/^(serve|listen)$/]${bunCallee} > ObjectExpression.arguments:not(:has(> Property[key.name='hostname']))`,
  `CallExpression[callee.property.name=/^(serve|listen)$/]${bunCallee} > ObjectExpression.arguments > Property[key.name='hostname'][value.value=${wildcardAddress}]`,
  // The Identifier type matters: esquery reads a Literal's missing name as
  // the string 'undefined', which would match every hostname.
  `CallExpression[callee.property.name=/^(serve|listen)$/]${bunCallee} > ObjectExpression.arguments > Property[key.name='hostname'] > Identifier.value[name='undefined']`,
  // ISSUE-278: serve and listen imported from 'bun', and Bun under another
  // name, reach the same servers without the Bun callee the selectors see.
  "ImportDeclaration[source.value='bun'] > ImportSpecifier[imported.name=/^(serve|listen)$/]",
  "VariableDeclarator[id.type='Identifier']:matches([init.name='Bun'], [init.object.name='globalThis'][init.property.name='Bun'])",
  // ISSUE-283, ISSUE-286: 'bun' imported whole (namespace, default, the
  // default by name, or dynamically) is Bun under another name.
  "ImportDeclaration[source.value='bun'] > :matches(ImportNamespaceSpecifier, ImportDefaultSpecifier)",
  "ImportDeclaration[source.value='bun'] > ImportSpecifier[imported.name='default']",
  // A dynamic import stays clean when it takes named values (SQL), and is
  // rejected when it can reach a server: the module bound whole, serve or
  // listen destructured, called on the awaited module, or handed to then().
  "VariableDeclarator[id.type='Identifier'] > AwaitExpression.init > ImportExpression[source.value='bun']",
  "VariableDeclarator[init.type='AwaitExpression'][init.argument.type='ImportExpression'][init.argument.source.value='bun'] > ObjectPattern.id > Property[key.name=/^(serve|listen)$/]",
  "MemberExpression[property.name=/^(serve|listen)$/] > AwaitExpression.object > ImportExpression[source.value='bun']",
  "CallExpression[callee.property.name='then'] > MemberExpression.callee > ImportExpression.object[source.value='bun']",
  "VariableDeclarator:matches([init.name='Bun'], [init.object.name='globalThis'][init.property.name='Bun']) > ObjectPattern > Property[key.name=/^(serve|listen)$/]",
  `CallExpression[callee.property.name='listen']:not(${bunCallee}):not([arguments.0.type='Literal'][arguments.0.value=/^[^0-9]/]):not([arguments.0.type='TemplateLiteral']):matches([arguments.length=1][arguments.0.type!='ObjectExpression'], [arguments.1.type=/Function/])`,
  `CallExpression[callee.property.name='listen']:not(${bunCallee}) > ObjectExpression.arguments:not(:has(> Property[key.name='host']))`,
  `CallExpression[callee.property.name='listen']:not(${bunCallee}) > Literal.arguments[value=${wildcardAddress}]`,
  `CallExpression[callee.property.name='listen']:not(${bunCallee}) > ObjectExpression.arguments > Property[key.name='host'][value.value=${wildcardAddress}]`,
].map((selector) => ({ selector, message: bindMessage }));

/**
 * ISSUE-245: an integration file reaches Redis only through the guarded
 * helper (`openTestRedis`, whose URL came from `requireTestServices`, which
 * refuses any database or server that is not the slot's own) and never
 * deletes database-wide, so running any one file directly can never touch
 * another slot's, dev's or e2e's keys.
 */
const testRedisRestrictions = [
  {
    selector: "NewExpression[callee.name='RedisClient']",
    message:
      "Open Redis with openTestRedis(url) from @daisy/redis/testing: it takes only a URL requireTestServices guarded as the slot's own database.",
  },
  {
    selector: "NewExpression[callee.property.name='RedisClient']",
    message:
      'Open Redis with openTestRedis(url) from @daisy/redis/testing, not a namespaced RedisClient.',
  },
  {
    selector:
      "MemberExpression[object.name='Bun'][property.name=/^(?:redis|RedisClient)$/], MemberExpression[object.name='Bun'][computed=true][property.value=/^(?:redis|RedisClient)$/], MemberExpression[object.property.name='Bun'][property.name=/^(?:redis|RedisClient)$/]",
    message:
      'Bun.redis and Bun.RedisClient dial Redis without requireTestServices: open Redis with openTestRedis(url).',
  },
  {
    selector:
      "VariableDeclarator[init.name='Bun'] > ObjectPattern > Property[key.name=/^(?:redis|RedisClient)$/], VariableDeclarator[init.property.name='Bun'] > ObjectPattern > Property[key.name=/^(?:redis|RedisClient)$/]",
    message:
      'Do not pull redis or RedisClient out of Bun: open Redis with openTestRedis(url).',
  },
  {
    selector:
      "VariableDeclarator[id.type='Identifier'][init.name='Bun'], VariableDeclarator[id.type='Identifier'][init.property.name='Bun'], VariableDeclarator[id.type='Identifier'][init.computed=true][init.property.value='Bun'], ObjectPattern > Property[key.name='Bun']",
    message:
      'Do not alias the Bun global: a suite reaches Redis only through openTestRedis(url).',
  },
  {
    selector:
      "ImportExpression[source.value='bun'], CallExpression[callee.name='require'][arguments.0.value='bun']",
    message:
      "Import 'bun' statically (only SQL and the like): a dynamic import or require reaches RedisClient and redis.",
  },
  {
    selector:
      "MemberExpression[property.name='constructor'], MemberExpression[computed=true][property.value='constructor']",
    message:
      'Never reach a constructor from a value in a suite: openTestRedis returns a wrapper with none, and a raw client is not for tests.',
  },
  {
    selector:
      "CallExpression[callee.name='deleteKeysWithoutExpiry'][arguments.length<2], CallExpression[callee.name='deleteKeysWithoutExpiry'][arguments.1.value='*']",
    message:
      'Never scan the whole database in a suite: pass deleteKeysWithoutExpiry a pattern under your own namespace.',
  },
  {
    selector: "ImportSpecifier[imported.name='deleteAllKeysWithoutExpiry']",
    message:
      "deleteAllKeysWithoutExpiry walks the whole database and is the runner's alone.",
  },
  {
    selector: 'Literal[value=/^(?:FLUSHDB|FLUSHALL)$/i]',
    message: 'Never FLUSHDB or FLUSHALL: delete exactly your own namespace.',
  },
  {
    selector:
      "CallExpression[callee.property.name='send'][arguments.0.value=/^scan$/i]:has(ArrayExpression > Literal[value='*'])",
    message:
      'Never SCAN the whole database in a suite: match your own namespace.',
  },
  {
    selector:
      "CallExpression[callee.property.name='send'][arguments.0.value=/^keys$/i]:has(ArrayExpression > Literal[value='*'])",
    message:
      'Never list every key of the database in a suite: match your own namespace.',
  },
  {
    selector:
      "CallExpression[callee.property.name='keys'][arguments.0.value='*']",
    message:
      'Never list every key of the database in a suite: match your own namespace.',
  },
  {
    selector:
      "CallExpression[callee.property.name='send'][arguments.length=2][arguments.1.type='ArrayExpression']:not([arguments.0.type='Literal'])",
    message:
      'Name the Redis command as a string literal so it can be checked; a template, join or variable can hide FLUSHDB or a whole-database scan.',
  },
];

/** `bun`'s Redis exports in an integration file: only a type-only import of RedisClient is fine. */
const bunRedisImport = {
  name: 'bun',
  importNames: ['RedisClient', 'redis'],
  allowTypeImports: true,
  message:
    "Open Redis with openTestRedis(url) from @daisy/redis/testing; the default 'redis' export dials REDIS_URL and skips requireTestServices.",
};

/**
 * ISSUE-7's process edge: app code receives configuration and resources as
 * arguments from a composition root, so nothing in an app may mutate
 * process.env or globalThis, tests included (each builds its own app).
 * Shared by the repo-wide `no-restricted-syntax` entry and the apps'
 * integration override below, which replaces that entry's options.
 */
const processMutationRestrictions = [
  {
    selector:
      "AssignmentExpression > MemberExpression.left[object.object.name='process'][object.property.name='env']",
    message: 'Never write process.env; build an app with its own env.',
  },
  {
    selector:
      "AssignmentExpression > MemberExpression.left[object.name='globalThis']",
    message: 'Never write globalThis; inject the value instead.',
  },
  {
    selector:
      "UnaryExpression[operator='delete'] > MemberExpression[object.object.name='process'][object.property.name='env']",
    message: 'Never delete from process.env; build an app with its own env.',
  },
  {
    selector:
      "UnaryExpression[operator='delete'] > MemberExpression[object.name='globalThis']",
    message: 'Never delete from globalThis; inject the value instead.',
  },
  {
    selector:
      "CallExpression[callee.object.name=/^(Object|Reflect)$/][callee.property.name=/^(assign|set|deleteProperty|defineProperty)$/][arguments.0.object.name='process'][arguments.0.property.name='env']",
    message: 'Never write process.env; build an app with its own env.',
  },
  {
    selector:
      "CallExpression[callee.object.name=/^(Object|Reflect)$/][callee.property.name=/^(assign|set|deleteProperty|defineProperty)$/][arguments.0.name='globalThis']",
    message: 'Never write globalThis; inject the value instead.',
  },
];

/** Every app module's import boundary (the process-edge entries below add to it). */
const appImportRestrictions = [{ group: ['@adobe/*', '@daisy/*/src/*'] }];

/**
 * ISSUE-7: the web process edge (`server/process-app.ts`) holds the
 * process's app, so importing it is reaching a process-wide locator. Route
 * modules and server action modules (`actions.ts`) may bind `processRoute`
 * only; the process entries (proxy,
 * instrumentation, production start, and the server-component session
 * read) may use `processApp`; everything else receives the app, or part of
 * it, as an argument.
 */
const processEdgeMessage =
  'Receive the app as an argument; only route bindings and the process entries import the process edge.';
/** Any specifier naming the edge module, relative or absolute, any extension. */
const processEdgePath = '(^|/)process-app(\\.[cm]?[jt]sx?)?$';
const processEdgeImport = {
  regex: processEdgePath,
  message: processEdgeMessage,
};
/** The same edge reached through `import()`; a computed specifier hides it. */
const processEdgeLoads = [
  {
    selector: `ImportExpression[source.value=/${processEdgePath.replaceAll('/', '\\/')}/]`,
    message: processEdgeMessage,
  },
  {
    selector: "ImportExpression[source.type!='Literal']",
    message:
      'Use a literal import() specifier so the import boundaries can check it.',
  },
];

const processEntries = [
  'apps/web/src/proxy.ts',
  'apps/web/src/instrumentation.ts',
  'apps/web/src/server/start.ts',
  'apps/web/src/lib/request-session.ts',
];

/**
 * ISSUE-9: the domain and contract packages are pure, so they read no host
 * clock, randomness, environment, timer or runtime at all; the app edges
 * inject each one. The repo-wide list above still applies on top.
 */
const pureAmbientGlobals = [
  ['performance', 'Inject a clock instead of reading the host timer.'],
  ['crypto', 'Inject an identity or randomness source.'],
  ['process', 'Receive configuration as an argument.'],
  ['Bun', 'Domain and contract packages are runtime-independent.'],
  ['globalThis', 'Receive resources as arguments.'],
  ...[
    'setTimeout',
    'setInterval',
    'setImmediate',
    'clearTimeout',
    'clearInterval',
    'clearImmediate',
    'queueMicrotask',
  ].map((name) => [name, 'Inject a scheduler instead of a host timer.']),
].map(([name, message]) => ({ name, message }));
const purePackages = [
  'packages/debate-engine/**/*.ts',
  'packages/protocol/**/*.ts',
  'packages/errors/**/*.ts',
  'packages/auth/**/*.ts',
];

/**
 * Every spec runs on the shared fixture (apps/web/e2e/support/fixtures.ts):
 * Playwright's own page fixture and a bare newPage have no bound, while the
 * shared ones fail a stalled page creation by name and keep the evidence
 * that tells the browser, the driver and our server apart (ISSUE-253,
 * ISSUE-276, ISSUE-277, ISSUE-279).
 */
const fixtureMessage =
  'Import test from ./support/fixtures, the shared fixture with a bounded page and failure diagnostics.';
const sharedFixtureRestrictions = [
  ...[
    "ImportDeclaration[source.value='@playwright/test'] > ImportSpecifier:matches([imported.name='test'], [imported.value='test'])",
    "ImportDeclaration[source.value='@playwright/test'][importKind!='type'] > :matches(ImportNamespaceSpecifier, ImportDefaultSpecifier)",
    "ExportNamedDeclaration[source.value='@playwright/test'] > ExportSpecifier[local.name='test']",
    "ImportExpression[source.value='@playwright/test']",
  ].map((selector) => ({ selector, message: fixtureMessage })),
  ...[
    "MemberExpression[computed=false][property.name='newPage']",
    // ISSUE-283: c['newPage'] and c[`newPage`] reach the same method.
    "MemberExpression[computed=true][property.value='newPage']",
    "MemberExpression[computed=true] > TemplateLiteral.property[expressions.length=0] > TemplateElement[value.cooked='newPage']",
    "ObjectPattern > Property[key.name='newPage']",
  ].map((selector) => ({
    selector,
    message:
      'Open a page with openPage from ./support/fixtures: it bounds page creation and keeps the stall evidence.',
  })),
];

/**
 * ISSUE-1010: a refusal is a closed `reason`, and a message is free text no
 * behaviour reads. The literal rule also catches a mint from a branch cut
 * before this, which would otherwise quietly lose its refusal. A vendor's own
 * error text (`error.message.includes('NOSCRIPT')`) is out of its reach.
 * Integration suites carry both. The process-edge override carries the mint
 * rules only: a script's plain `Error` text is its CLI output, which its tests
 * rightly compare, and `packages/clock` and `packages/observability` read no
 * refusal.
 */
const refusalMintRestrictions = [
  {
    selector:
      "CallExpression[callee.name='createAppError'] > MemberExpression.arguments:nth-child(2)[computed=false][property.name=/^(refusal|reason)$/]",
    message:
      "A decision's refusal is a reason: createRefusal(code, decision.refusal), never a message.",
  },
  {
    selector:
      "CallExpression[callee.name='createAppError'] > Literal.arguments:nth-child(2)[value=/^[a-z]+(-[a-z]+)+$/]",
    message:
      'A refusal word is a reason: createRefusal(code, reason), from a closed @daisy/protocol vocabulary.',
  },
  {
    selector:
      "CallExpression[callee.name='createAppError'] > ConditionalExpression.arguments:nth-child(2) > Literal[value=/^[a-z]+(-[a-z]+)+$/]",
    message:
      'A refusal word is a reason: createRefusal(code, reason), from a closed @daisy/protocol vocabulary.',
  },
];
const refusalReadRestrictions = [
  {
    selector:
      "SwitchStatement > ChainExpression.discriminant > MemberExpression[property.name='message'][object.name=/^(error|err|e|cause|failure)$/]",
    message: 'Branch on error.reason (createRefusal), never on error.message.',
  },
  {
    selector:
      "MemberExpression[computed=true] > ChainExpression.property > MemberExpression[property.name='message'][object.name=/^(error|err|e|cause|failure)$/]",
    message: 'Branch on error.reason (createRefusal), never on error.message.',
  },
  {
    selector:
      "CallExpression[callee.property.name=/^(includes|has|hasOwn|get)$/] > ChainExpression.arguments > MemberExpression[property.name='message'][object.name=/^(error|err|e|cause|failure)$/]",
    message: 'Branch on error.reason (createRefusal), never on error.message.',
  },
  {
    selector:
      "BinaryExpression[operator=/^[!=]==$/] > ChainExpression > MemberExpression[property.name='message'][object.name=/^(error|err|e|cause|failure)$/]",
    message: 'Branch on error.reason (createRefusal), never on error.message.',
  },
  {
    selector:
      "MemberExpression[computed=true] > MemberExpression.property[property.name='message'][object.name=/^(error|err|e|cause|failure)$/]",
    message: 'Branch on error.reason (createRefusal), never on error.message.',
  },
  {
    selector:
      "SwitchStatement > MemberExpression.discriminant[property.name='message'][object.name=/^(error|err|e|cause|failure)$/]",
    message: 'Branch on error.reason (createRefusal), never on error.message.',
  },
  {
    selector:
      "BinaryExpression[operator=/^[!=]==$/] > MemberExpression[property.name='message'][object.name=/^(error|err|e|cause|failure)$/]",
    message: 'Branch on error.reason (createRefusal), never on error.message.',
  },
  {
    selector:
      "CallExpression[callee.property.name=/^(includes|has|hasOwn|get)$/] > MemberExpression.arguments[property.name='message'][object.name=/^(error|err|e|cause|failure)$/]",
    message: 'Look up error.reason (createRefusal), never error.message.',
  },
];

/**
 * A unit test never waits on real time (ADR 0164): a sleep makes it slow
 * and, under load, wrong. Timed work takes its clock as a resource, and the
 * test hands it `virtualClock` from `@daisy/clock/testing`. A zero delay is
 * not a sleep (it yields one turn of the event loop), so `setTimeout(f, 0)`
 * and `Bun.sleep(0)` stay; every other `Bun.sleep`, `Bun.sleepSync`,
 * `setTimeout` and `setInterval` is an error.
 */
const zeroDelay = (node) =>
  node !== undefined && node.type === 'Literal' && node.value === 0;
const callableName = (node) => {
  if (node.type === 'Identifier') return node.name;
  if (node.type !== 'MemberExpression') return null;
  const receiver = callableName(node.object);
  const member = node.computed
    ? node.property.type === 'Literal' &&
      typeof node.property.value === 'string'
      ? node.property.value
      : null
    : node.property.type === 'Identifier'
      ? node.property.name
      : null;
  return receiver === null || member === null ? null : `${receiver}.${member}`;
};
const timerMethods = ['setTimeout', 'setInterval'];
const importedTimers = (program) => {
  const timers = new Map();
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    const moduleName = String(statement.source.value).replace(/^node:/, '');
    if (moduleName !== 'timers' && moduleName !== 'timers/promises') continue;
    const delayArgument = moduleName === 'timers' ? 1 : 0;
    for (const specifier of statement.specifiers) {
      if (specifier.type === 'ImportSpecifier') {
        const name = callableName(specifier.imported);
        if (timerMethods.includes(name))
          timers.set(specifier.local.name, { name, delayArgument });
      } else {
        for (const name of timerMethods)
          timers.set(`${specifier.local.name}.${name}`, {
            name,
            delayArgument,
          });
      }
    }
  }
  return timers;
};
const timedWait = (call, timers) => {
  const name = callableName(call.callee)?.replace(/^globalThis\./, '');
  const imported = timers.get(name);
  if (imported !== undefined)
    return imported.name === 'setInterval' ||
      !zeroDelay(call.arguments[imported.delayArgument])
      ? imported.name
      : null;
  if (name === 'Bun.sleep' || name === 'Bun.sleepSync')
    return zeroDelay(call.arguments[0]) ? null : name;
  if (name === 'setTimeout')
    return zeroDelay(call.arguments[1]) ? null : 'setTimeout';
  return name === 'setInterval' ? name : null;
};
const testTimePlugin = {
  rules: {
    'no-real-sleep': {
      meta: {
        type: 'problem',
        messages: {
          sleep:
            '{{name}} waits on real time in a unit test. Inject the clock and drive it with virtualClock from @daisy/clock/testing (ADR 0164).',
        },
        schema: [],
      },
      create: (context) => {
        let timers = new Map();
        return {
          Program: (program) => {
            timers = importedTimers(program);
          },
          CallExpression: (call) => {
            const name = timedWait(call, timers);
            if (name !== null)
              context.report({
                node: call,
                messageId: 'sleep',
                data: { name },
              });
          },
        };
      },
    },
  },
};

/** The repo-wide `no-restricted-syntax` list; overrides extend or replace it. */
const repoSyntaxRestrictions = [
  ...refusalMintRestrictions,
  ...refusalReadRestrictions,
  {
    selector:
      "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'Inject a clock instead of reading the current time directly.',
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message:
      'Inject a clock instead of constructing the current time directly.',
  },
  {
    selector:
      "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message: 'Inject a deterministic identity or randomness source.',
  },
  {
    selector:
      "CallExpression[callee.object.name='crypto'][callee.property.name='randomUUID']",
    message: 'Inject an identity generator instead of creating an ID directly.',
  },
  exportStarRestriction,
  bareToThrowRestriction,
  ...unboundServerRestrictions,
  ...processMutationRestrictions,
];

const dbOpeningRestrictions = [
  {
    selector:
      "ImportSpecifier[imported.name='BunSQLDatabase'], TSImportType[qualifier.name='BunSQLDatabase'], TSQualifiedName[right.name='BunSQLDatabase']",
    message: 'Use Tx or TxSource from the database transaction boundary.',
  },
  {
    selector:
      "MemberExpression:matches([property.name='transaction'], [property.value='transaction'])",
    message: 'Open database transactions with inTransaction.',
  },
];
const dbRawStatementRestrictions = [
  {
    selector:
      "MemberExpression:matches([property.name='execute'], [property.value='execute'])",
    message: 'Use query for parsed rows or run to discard them.',
  },
  {
    selector:
      ':matches(TSAsExpression, TSTypeAssertion) > :matches(TSAsExpression, TSTypeAssertion)[typeAnnotation.type="TSUnknownKeyword"]',
    message:
      'Validate database rows instead of asserting them through unknown.',
  },
];
const dbAdvisoryLockRestrictions = [
  {
    selector:
      'Literal[value=/pg_(try_)?advisory/i], TemplateElement[value.raw=/pg_(try_)?advisory/i], Literal[regex.pattern=/pg_(try_)?advisory/i]',
    message: 'Take the named advisory lock from the database lock registry.',
  },
];
// A selected SQL fragment is parsed by `parsedColumn`; a type argument on
// `sql` or a typed `SQL<T>` asserts a column type nobody read.
dbRawStatementRestrictions.push(
  {
    selector:
      "TaggedTemplateExpression[typeArguments]:matches([tag.name='sql'], [tag.property.name='sql'])",
    message:
      'Parse a selected fragment with parsedColumn(schema, sql`…`); a fragment only embedded in SQL takes no type argument.',
  },
  {
    selector:
      "TSTypeReference:matches([typeName.name='SQL'], [typeName.right.name='SQL']) > TSTypeParameterInstantiation > :not(TSUnknownKeyword)",
    message:
      'An SQL fragment is SQL (unknown) until parsedColumn parses it; do not assert its type.',
  },
  {
    selector:
      "MemberExpression:matches([property.name='mapWith'], [property.value='mapWith'])",
    message: 'Parse a selected fragment with parsedColumn.',
  },
);
const dbBoundaryRestrictions = {
  'tx.ts': dbOpeningRestrictions,
  'raw-rows.ts': dbRawStatementRestrictions,
  'locks.ts': dbAdvisoryLockRestrictions,
};
/**
 * Every source tree that opens PostgreSQL: the participant database's
 * package and the admin app's own database (ADR 0077). Each keeps the same
 * three homes, and the restrictions hold everywhere else in the tree.
 */
const dbBoundaryRoots = ['packages/db/src', 'apps/admin/src/db'];
const dbBoundaryTrees = {
  'packages/db/src': 'packages/db/src',
  'apps/admin/src/db': 'apps/admin/src',
};

const dbNativeRowsPlugin = {
  rules: {
    'require-query': {
      meta: {
        messages: { boundary: 'Validate native database rows with query.' },
      },
      create(context) {
        const { program, esTreeNodeToTSNodeMap, tsNodeToESTreeNodeMap } =
          context.sourceCode.parserServices;
        if (!program) return {};
        const checker = program.getTypeChecker();
        // The bounded client's transport proxy forwards the driver's queries
        // to Drizzle. Any row consumption inside it still needs query.
        const forwardsQueries = context.filename.endsWith(
          '/packages/db/src/transaction-client.ts',
        );
        const types = (type) =>
          type.isUnionOrIntersection() ? type.types : [type];
        const typeAt = (node) =>
          checker.getTypeAtLocation(esTreeNodeToTSNodeMap.get(node));
        const constrainedType = (type) =>
          type.isTypeParameter()
            ? (checker.getBaseConstraintOfType(type) ?? type)
            : type;
        const nativeType = (input) => {
          if (input === undefined) return false;
          const type = constrainedType(input);
          if (type.isUnionOrIntersection()) return type.types.some(nativeType);
          const symbol = type.getSymbol();
          return (
            symbol?.name === 'Query' &&
            symbol
              .getDeclarations()
              ?.some((declaration) =>
                declaration
                  .getSourceFile()
                  .fileName.endsWith('/bun-types/sql.d.ts'),
              )
          );
        };
        const nativeQuery = (expression) =>
          expression != null && nativeType(typeAt(expression));
        const returnsNativeRows = (callback) =>
          callback
            .getCallSignatures()
            .some((signature) => nativeType(signature.getReturnType()));
        const builtInMethod = (signature) => {
          const declaration = signature?.getDeclaration();
          if (!declaration) return undefined;
          const owner = (
            declaration.parent.name ?? declaration.parent.parent?.name
          )?.getText();
          const sourceFile = declaration.getSourceFile();
          if (
            program.isSourceFileDefaultLibrary(sourceFile) ||
            (owner === 'PromiseConstructor' &&
              sourceFile.fileName.endsWith('/bun-types/globals.d.ts'))
          )
            return { owner, name: declaration.name?.getText() };
        };
        const declarationOf = (expression) => {
          const location = esTreeNodeToTSNodeMap.get(expression);
          return (
            ts.isShorthandPropertyAssignment(location.parent)
              ? checker.getShorthandAssignmentValueSymbol(location.parent)
              : checker.getSymbolAtLocation(location)
          )?.valueDeclaration;
        };
        const constantDeclaration = (declaration) =>
          declaration &&
          ts.isVariableDeclaration(declaration) &&
          (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0;
        const staticKey = (key, computed) => {
          if (!computed && key.type === 'Identifier') return key.name;
          if (
            key.type === 'Literal' &&
            (typeof key.value === 'string' || typeof key.value === 'number')
          )
            return String(key.value);
        };
        const literalMember = (object, key) => {
          if (object?.type !== 'ObjectExpression' || key === undefined)
            return undefined;
          for (const property of [...object.properties].reverse()) {
            if (property.type === 'SpreadElement') return undefined;
            if (staticKey(property.key, property.computed) === key)
              return property.kind === 'init' ? property.value : undefined;
          }
        };
        const destructuredMember = (declaration) => {
          if (
            !declaration ||
            !ts.isBindingElement(declaration) ||
            !ts.isObjectBindingPattern(declaration.parent) ||
            declaration.dotDotDotToken ||
            declaration.initializer
          )
            return undefined;
          const owner = declaration.parent.parent;
          const property = declaration.propertyName ?? declaration.name;
          if (
            !constantDeclaration(owner) ||
            !owner.initializer ||
            !(
              ts.isIdentifier(property) ||
              ts.isStringLiteralLike(property) ||
              ts.isNumericLiteral(property)
            )
          )
            return undefined;
          const expression = tsNodeToESTreeNodeMap.get(owner.initializer);
          return expression ? { expression, key: property.text } : undefined;
        };
        const localMember = (receiver, key, read, seen) => {
          const object = constantSource(receiver, seen);
          if (object?.type !== 'ObjectExpression' || key === undefined)
            return undefined;
          // Check preceding statements in the read's block and its enclosing
          // blocks. Writes outside the current function have separate timing.
          for (
            let statement = read;
            statement.parent;
            statement = statement.parent
          ) {
            const block = statement.parent;
            if (
              [
                'ArrowFunctionExpression',
                'FunctionExpression',
                'FunctionDeclaration',
              ].includes(block.type)
            )
              break;
            if (!['BlockStatement', 'Program'].includes(block.type)) continue;
            for (
              let index = block.body.indexOf(statement) - 1;
              index >= 0;
              index -= 1
            ) {
              const candidate = block.body[index];
              if (candidate.range[0] <= object.range[0]) break;
              if (candidate.type !== 'ExpressionStatement') continue;
              const assignment = candidate.expression;
              if (
                assignment.type === 'AssignmentExpression' &&
                assignment.operator === '=' &&
                assignment.left.type === 'MemberExpression' &&
                staticKey(
                  assignment.left.property,
                  assignment.left.computed,
                ) === key &&
                constantSource(assignment.left.object) === object
              )
                return assignment.right;
            }
          }
          return literalMember(object, key);
        };
        const constantSource = (value, seen = new Set()) => {
          if (!value) return undefined;
          while (!seen.has(value)) {
            seen.add(value);
            if (
              [
                'TSAsExpression',
                'TSSatisfiesExpression',
                'TSNonNullExpression',
                'TSInstantiationExpression',
                'TSTypeAssertion',
              ].includes(value.type)
            ) {
              value = value.expression;
              continue;
            }
            let initializer;
            if (value.type === 'MemberExpression') {
              initializer = localMember(
                value.object,
                staticKey(value.property, value.computed),
                value,
                seen,
              );
            }
            if (value.type === 'Identifier') {
              const declaration = declarationOf(value);
              if (constantDeclaration(declaration) && declaration.initializer)
                initializer = tsNodeToESTreeNodeMap.get(
                  declaration.initializer,
                );
              const member = destructuredMember(declaration);
              if (member)
                initializer = localMember(
                  member.expression,
                  member.key,
                  member.expression,
                  seen,
                );
            }
            if (!initializer) break;
            value = initializer;
          }
          return value;
        };
        const originalCallableType = (source) => {
          const member =
            source.type === 'Identifier' &&
            destructuredMember(declarationOf(source));
          if (member) {
            const object = constantSource(member.expression);
            const property = typeAt(object).getProperty(member.key);
            if (property)
              return checker.getTypeOfSymbolAtLocation(
                property,
                esTreeNodeToTSNodeMap.get(object),
              );
          }
          return typeAt(source);
        };
        const functionAdapter = (method) =>
          ['CallableFunction', 'Function'].includes(method.owner) &&
          ['call', 'apply', 'bind'].includes(method.name);
        const reflectApply = (method) =>
          method.owner === 'Reflect' && method.name === 'apply';
        const promiseMethod = (method) =>
          (method.owner === 'PromiseConstructor' &&
            ['resolve', 'all', 'allSettled', 'any', 'race', 'try'].includes(
              method.name,
            )) ||
          (['Promise', 'PromiseLike'].includes(method.owner) &&
            ['then', 'catch', 'finally'].includes(method.name));
        const supportedMethod = (method) =>
          method !== undefined &&
          (promiseMethod(method) ||
            functionAdapter(method) ||
            reflectApply(method));
        const inputValue = (expression) => {
          const location = esTreeNodeToTSNodeMap.get(expression);
          return {
            expression,
            location,
            type: checker.getTypeAtLocation(location),
          };
        };
        const inputAt = (inputs, index) => {
          const rest = inputs.findIndex((input) => input?.rest);
          return inputs[rest >= 0 && rest <= index ? rest : index];
        };
        const afterReceiver = (inputs) =>
          inputs[0]?.rest ? inputs : inputs.slice(1);
        const packedInputs = (input) => {
          if (!input) return [];
          const source = constantSource(input.expression);
          if (source?.type === 'ArrayExpression')
            return callInputs(source.elements);
          const type = constrainedType(input.type);
          if (checker.isTupleType(type))
            return checker
              .getTypeArguments(type)
              .map((type) => ({ type, location: input.location }));
          const element = type.getNumberIndexType();
          return element
            ? [{ type: element, location: input.location, rest: true }]
            : [];
        };
        const callInputs = (args) =>
          args.flatMap((argument) => {
            if (argument?.type === 'SpreadElement')
              return packedInputs(inputValue(argument.argument));
            return [argument ? inputValue(argument) : undefined];
          });
        const callableInput = (input, active, remaining) => {
          if (!input || remaining === 0) return undefined;
          const source = constantSource(input.expression);
          if (source?.type === 'CallExpression' && !active.has(source)) {
            active.add(source);
            const binding = resolveCall(source, active, remaining - 1)?.binding;
            active.delete(source);
            if (binding) return { binding };
          }
          const type = source ? originalCallableType(source) : input.type;
          const method = type
            .getCallSignatures()
            .map(builtInMethod)
            .find(supportedMethod);
          return method ? { method } : undefined;
        };
        const invoke = (callable, receiver, inputs, active, remaining) => {
          if (!callable || remaining === 0) return undefined;
          if (callable.binding) {
            const { target, receiver, inputs: bound } = callable.binding;
            return invoke(
              target,
              receiver,
              [...bound, ...inputs],
              active,
              remaining - 1,
            );
          }
          const { method } = callable;
          if (reflectApply(method))
            return invoke(
              callableInput(inputAt(inputs, 0), active, remaining - 1),
              inputAt(inputs, 1),
              packedInputs(inputAt(inputs, 2)),
              active,
              remaining - 1,
            );
          if (functionAdapter(method)) {
            const target = callableInput(receiver, active, remaining - 1);
            if (!target) return undefined;
            const thisArg = inputAt(inputs, 0);
            if (method.name === 'bind')
              return {
                binding: {
                  target,
                  receiver: thisArg,
                  inputs: afterReceiver(inputs),
                },
              };
            const unwrapped =
              method.name === 'apply'
                ? packedInputs(inputAt(inputs, 1))
                : afterReceiver(inputs);
            return invoke(target, thisArg, unwrapped, active, remaining - 1);
          }
          return { method, inputs };
        };
        const resolveCall = (call, active, remaining, signature) => {
          const { callee, arguments: args } = call;
          const source = callableInput(
            inputValue(callee),
            active,
            remaining - 1,
          );
          const method = builtInMethod(
            signature ??
              checker.getResolvedSignature(esTreeNodeToTSNodeMap.get(call)),
          );
          const callable =
            source ?? (supportedMethod(method) ? { method } : undefined);
          if (!callable) return undefined;
          const receiver =
            callee.type === 'MemberExpression'
              ? inputValue(callee.object)
              : undefined;
          return invoke(
            callable,
            receiver,
            callInputs(args),
            active,
            remaining - 1,
          );
        };
        const promiseInputs = (call, signature) => {
          // Aliases in incomplete or recursive source can point back to the call.
          const active = new Set([call]);
          const plan = resolveCall(call, active, 32, signature);
          return plan?.binding
            ? invoke({ binding: plan.binding }, undefined, [], active, 32)
            : plan;
        };
        // Use the well-known symbol's identity, including when a declaration
        // spells its iterator key through an alias.
        const iteratorKey = (() => {
          const symbol = checker.resolveName(
            'Symbol',
            undefined,
            ts.SymbolFlags.Value,
            false,
          );
          if (!symbol) return undefined;
          const iterator = checker
            .getTypeOfSymbol(symbol)
            .getProperty('iterator');
          if (iterator) {
            const key = checker.getTypeOfSymbol(iterator);
            if (key.flags & ts.TypeFlags.UniqueESSymbol) return key.escapedName;
          }
        })();
        const nativeIterable = (inputType, location) => {
          if (!iteratorKey) return false;
          const propertyType = (symbol) =>
            checker.getTypeOfSymbolAtLocation(symbol, location);
          const methodResults = (symbol) =>
            propertyType(symbol)
              .getCallSignatures()
              .map((signature) => signature.getReturnType());
          return types(constrainedType(inputType)).some((type) => {
            // Promise combinators assimilate each value yielded by the
            // iterable. Inspect next().value, including Set and generators.
            const iterator = type
              .getProperties()
              .find((symbol) => symbol.escapedName === iteratorKey);
            if (!iterator) return false;
            return methodResults(iterator).some((result) => {
              const next = result.getProperty('next');
              if (!next) return false;
              return methodResults(next)
                .flatMap(types)
                .some((step) => {
                  const done = step.getProperty('done');
                  if (
                    done &&
                    checker.isTypeAssignableTo(
                      propertyType(done),
                      checker.getTrueType(),
                    )
                  )
                    return false;
                  const value = step.getProperty('value');
                  return value !== undefined && nativeType(propertyType(value));
                });
            });
          });
        };
        // Command metadata lives on the Bun result outside the rows.
        const commandReceipt = (statement) =>
          statement.type === 'TaggedTemplateExpression' &&
          statement.quasi.expressions.length === 0 &&
          ['commit', 'rollback'].includes(statement.quasi.quasis[0]?.value.raw);
        const report = (node) =>
          context.report({ node, messageId: 'boundary' });
        return {
          AwaitExpression(node) {
            if (
              node.parent.type !== 'ExpressionStatement' &&
              !commandReceipt(node.argument) &&
              nativeQuery(node.argument)
            )
              report(node);
          },
          ReturnStatement(node) {
            if (!forwardsQueries && nativeQuery(node.argument)) report(node);
          },
          ArrowFunctionExpression(node) {
            if (
              node.async &&
              node.expression &&
              !forwardsQueries &&
              nativeQuery(node.body)
            )
              report(node.body);
          },
          CallExpression(node) {
            const callee = node.callee;
            if (callee.type === 'MemberExpression') {
              const method = callee.computed
                ? callee.property.value
                : callee.property.name;
              if (
                ['then', 'catch', 'finally'].includes(method) &&
                nativeQuery(callee.object)
              ) {
                report(node);
                return;
              }
            }
            if (node.arguments.length === 0) return;
            const signature = checker.getResolvedSignature(
              esTreeNodeToTSNodeMap.get(node),
            );
            const boundary = signature
              ?.getDeclaration()
              ?.getSourceFile()
              .fileName.endsWith('/packages/db/src/raw-rows.ts');
            // Passing the thenable directly hands its execution to the callee,
            // including native Promise executor and deferred resolve functions.
            if (
              !forwardsQueries &&
              !boundary &&
              node.arguments.some(
                (argument) =>
                  argument.type !== 'SpreadElement' &&
                  nativeQuery(argument) &&
                  !nativeType(
                    checker.getContextualType(
                      esTreeNodeToTSNodeMap.get(argument),
                    ),
                  ),
              )
            ) {
              report(node);
              return;
            }
            const settlement = promiseInputs(node, signature);
            if (!settlement?.method) return;
            const { method, inputs } = settlement;
            if (method.owner !== 'PromiseConstructor') {
              if (
                inputs.some((input) => input && returnsNativeRows(input.type))
              )
                report(node);
              return;
            }
            const input = inputAt(inputs, 0);
            if (!input) return;
            const { type: inputType, location } = input;
            if (method.name === 'resolve') {
              if (nativeType(inputType)) report(node);
              return;
            }
            if (method.name === 'try') {
              if (returnsNativeRows(inputType)) report(node);
              return;
            }
            if (nativeIterable(inputType, location)) report(node);
          },
        };
      },
    },
  },
};

/**
 * The rules that read types. They run on workspace source only, which a
 * TypeScript project owns; a probe under an invented path turns them off
 * (eslint.config.test-support.ts).
 */
export const typedRules = {
  'daisy-form/require-callable-action': 'error',
  '@typescript-eslint/switch-exhaustiveness-check': [
    'error',
    {
      considerDefaultExhaustiveForUnions: false,
      requireDefaultForNonUnion: false,
    },
  ],
  // A cast that changes nothing hides the one that does. State a type
  // where the value is made (an annotation, a type argument), not after.
  '@typescript-eslint/no-unnecessary-type-assertion': 'error',
  // A promise nobody awaits loses its failure. Await it, return it, or mark
  // it `void` where the callee reports its own failures.
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  '@typescript-eslint/await-thenable': 'error',
  // What is thrown is an Error, so every catch can read a stack and a
  // cause. A caught value thrown again keeps its identity.
  // Text made from a value with no text of its own reads "[object Object]".
  '@typescript-eslint/no-base-to-string': 'error',
  '@typescript-eslint/only-throw-error': [
    'error',
    { allowThrowingAny: false, allowThrowingUnknown: true },
  ],
  // A check the type already answers is dead code or a wrong type. Correct
  // the type where the value is made, or delete the branch; never widen a
  // type to keep a check alive.
  '@typescript-eslint/no-unnecessary-condition': 'error',
};

/**
 * A non-null assertion claims what the type does not say. Model the state
 * instead: a union, a narrowing, or a function that returns the value it
 * found. The one form left is `array[index]!`, which
 * `noUncheckedIndexedAccess` asks for where a bound proves the index. A
 * property name in brackets still names a property. The rule reads syntax
 * only, so it needs no type information.
 */
const nonNullAssertion = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      assertion:
        'Model the state instead of asserting non-null: a union, a narrowing, or a returned value. Only `array[index]!` is allowed, where a bound proves the index.',
    },
  },
  create: (context) => ({
    TSNonNullExpression(node) {
      const { expression } = node;
      if (expression.type === 'MemberExpression' && expression.computed) {
        let key = expression.property;
        while (
          key.type === 'TSAsExpression' ||
          key.type === 'TSSatisfiesExpression' ||
          key.type === 'TSTypeAssertion' ||
          key.type === 'TSNonNullExpression'
        )
          key = key.expression;
        if (
          key.type !== 'TemplateLiteral' &&
          (key.type !== 'Literal' || typeof key.value === 'number')
        )
          return;
      }
      context.report({ node, messageId: 'assertion' });
    },
  }),
};
const daisyPlugin = { rules: { 'no-non-null-assertion': nonNullAssertion } };

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/next-env.d.ts',
      '**/migrations/**',
      '.pu/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  ...clockDigestRules,
  requestPathRules,
  clientEdgeRules,
  hostTimeRules,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { plugins: { 'daisy-form': formActionPlugin } },
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...repoSyntaxRestrictions],
    },
  },
  // App Router only: the pages-dir heuristic cannot resolve from the repo root.
  ...nextVitals.map((config) => ({
    ...config,
    files: ['apps/web/**/*.{ts,tsx,js,mjs}'],
    rules: { ...config.rules, '@next/next/no-html-link-for-pages': 'off' },
  })),
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      // Size and complexity are not lint rules: a warning nobody must act on
      // buried the errors in 1,119 lines. `bun metrics` reports both (ADR 0083).
    },
  },
  // Token-locked Tailwind (ADR 0028): classes must come from the Daisy theme in
  // globals.css. Arbitrary values, per-element dark variants, unknown,
  // conflicting and duplicate classes fail here; exceptions go through
  // policy/exceptions.json.
  {
    files: ['apps/web/**/*.tsx', 'apps/web/**/*-class.ts'],
    plugins: { 'better-tailwindcss': betterTailwind },
    settings: {
      'better-tailwindcss': {
        entryPoint: 'apps/web/src/app/globals.css',
      },
    },
    rules: {
      'better-tailwindcss/no-unknown-classes': 'error',
      'better-tailwindcss/no-conflicting-classes': 'error',
      'better-tailwindcss/no-duplicate-classes': 'error',
      'better-tailwindcss/no-restricted-classes': [
        'error',
        {
          restrict: [
            {
              pattern: '\\[',
              message:
                'Arbitrary values and properties bypass the design tokens; add a token to the theme instead.',
            },
            {
              pattern: '(^|:)(dark|scheme-[a-z-]+):',
              message:
                'Theme colors come from light-dark() tokens; do not add per-element color-scheme variants.',
            },
            {
              pattern: '^scheme-',
              message:
                'color-scheme is owned by <html data-theme> in globals.css.',
            },
          ],
        },
      ],
    },
  },
  // Variant class modules hold nothing but class strings, under whatever
  // variable names read best (`base`, `tones`, `sizes`), so every string and
  // object value in them is checked, not only the default `className` names.
  {
    files: ['apps/web/**/*-class.ts'],
    settings: {
      'better-tailwindcss': {
        entryPoint: 'apps/web/src/app/globals.css',
        selectors: [
          ...getDefaultSelectors(),
          {
            kind: 'variable',
            name: '.*',
            match: [{ type: 'strings' }, { type: 'objectValues' }],
          },
        ],
      },
    },
  },
  {
    files: ['packages/debate-engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'next',
            'next/*',
            'react',
            'react/*',
            'drizzle-orm',
            'drizzle-orm/*',
            'bun',
            'bun:sqlite',
            // RITEway's Bun-native test helper subpath, not the Bun runtime.
            '!riteway/bun',
            'node:*',
            '@daisy/db',
            '@daisy/redis',
            '@daisy/web',
            '@daisy/ui',
          ],
        },
      ],
    },
  },
  {
    files: [
      'packages/protocol/**/*.ts',
      'packages/auth/**/*.ts',
      'packages/errors/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'next',
            'next/*',
            'react',
            'react/*',
            'drizzle-orm',
            'drizzle-orm/*',
            'bun',
            'bun:sqlite',
            '!riteway/bun',
            'node:*',
            '@adobe/*',
            '@daisy/*/src/*',
            '@daisy/db',
            '@daisy/redis',
            // ISSUE-167: packages/auth is the framework-free identity domain
            // (Identity, Requirement, username shape); Better Auth is a
            // delivery-layer detail apps/web composes, never a domain import.
            'better-auth',
            'better-auth/*',
          ],
        },
      ],
    },
  },
  {
    files: ['packages/db/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'next',
            'next/*',
            'react',
            'react/*',
            '@adobe/*',
            '@daisy/*/src/*',
            '@daisy/web',
            '@daisy/debate-engine',
          ],
        },
      ],
    },
  },
  {
    files: ['apps/**/*.ts', 'apps/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', { patterns: appImportRestrictions }],
    },
  },
  {
    // ADR 0037: the Sentry SDK is a vendor seam with exactly two adapter
    // homes — apps/web's telemetry feature (plus the build wrapper that
    // uploads source maps) and apps/realtime's own adapter. The apps-wide
    // entry below carries the ban; the entries after it open the adapters.
    files: ['apps/realtime/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...appImportRestrictions,
            {
              group: ['@sentry/*'],
              message:
                'Import Sentry only inside apps/realtime/src/telemetry/ (ADR 0037).',
            },
          ],
        },
      ],
    },
  },
  {
    // The AUTH-6.7 load harness (apps/web/scripts/auth-load) is procedural
    // CLI glue exactly like the root scripts/ tree, not application source.
    files: ['scripts/**/*.ts', 'apps/web/scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // Ambient-time/identity primitives are legitimately used here (clocks,
  // observability instrumentation, CLI scripts, integration test setup), but
  // the export-star ban applies to every workspace source file with no
  // exception: a flat-config rule array replaces the whole options list for
  // a rule id, so re-declaring `no-restricted-syntax` here with only the
  // `ExportAllDeclaration` selector turns the ambient-time restriction off
  // for these paths while keeping the export-star gate on.
  {
    files: [
      'packages/clock/**/*.ts',
      'packages/observability/**/*.ts',
      'scripts/**/*.ts',
      'apps/web/scripts/**/*.ts',
      '**/integration/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...refusalMintRestrictions,
        exportStarRestriction,
        bareToThrowRestriction,
        ...unboundServerRestrictions,
      ],
    },
  },
  {
    files: ['**/integration/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [bunRedisImport] }],
    },
  },
  {
    files: ['**/integration/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...refusalMintRestrictions,
        ...refusalReadRestrictions,
        exportStarRestriction,
        bareToThrowRestriction,
        ...unboundServerRestrictions,
        ...testRedisRestrictions,
      ],
    },
  },
  // Integration setup may read ambient time, but app suites still never
  // mutate process-wide state (the exemption above replaced the list).
  {
    files: ['apps/**/integration/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...refusalMintRestrictions,
        ...refusalReadRestrictions,
        exportStarRestriction,
        bareToThrowRestriction,
        ...unboundServerRestrictions,
        ...processMutationRestrictions,
        ...testRedisRestrictions,
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/server/process-app.ts', ...processEntries],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...appImportRestrictions,
            {
              group: ['@sentry/*'],
              message:
                'Import Sentry only inside src/features/telemetry/ or next.config.ts (ADR 0037).',
            },
            processEdgeImport,
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        ...repoSyntaxRestrictions,
        ...processEdgeLoads,
      ],
    },
  },
  // Tests build their own app with createApp; only the browser suite's
  // server, itself a process entry, hands the edge its app.
  {
    files: ['apps/web/integration/**/*.ts', 'apps/web/e2e/**/*.ts'],
    ignores: [
      'apps/web/e2e/support/server.ts',
      'apps/web/e2e/support/room-launch-app.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...appImportRestrictions, processEdgeImport] },
      ],
    },
  },
  {
    files: ['apps/web/integration/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [bunRedisImport],
          patterns: [...appImportRestrictions, processEdgeImport],
        },
      ],
      'no-restricted-syntax': [
        'error',
        ...refusalMintRestrictions,
        ...refusalReadRestrictions,
        exportStarRestriction,
        bareToThrowRestriction,
        ...unboundServerRestrictions,
        ...processMutationRestrictions,
        ...processEdgeLoads,
        ...testRedisRestrictions,
      ],
    },
  },
  {
    files: ['apps/web/e2e/**/*.ts'],
    ignores: [
      'apps/web/e2e/support/server.ts',
      'apps/web/e2e/support/room-launch-app.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...repoSyntaxRestrictions,
        ...processEdgeLoads,
        ...sharedFixtureRestrictions,
      ],
    },
  },
  // The shared fixture is the one module built on Playwright's own test and
  // newPage; every other e2e restriction still applies to it.
  {
    files: ['apps/web/e2e/support/fixtures.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...repoSyntaxRestrictions,
        ...processEdgeLoads,
      ],
    },
  },
  ...dbBoundaryRoots.flatMap((root) => {
    const tree = dbBoundaryTrees[root];
    const homes = Object.keys(dbBoundaryRestrictions);
    return [
      {
        files: [`${tree}/**/*.{ts,tsx}`],
        ignores: homes.map((home) => `${root}/${home}`),
        rules: {
          'no-restricted-syntax': [
            'error',
            ...repoSyntaxRestrictions,
            ...Object.values(dbBoundaryRestrictions).flat(),
          ],
        },
      },
      ...homes.map((home) => ({
        files: [`${root}/${home}`],
        rules: {
          'no-restricted-syntax': [
            'error',
            ...repoSyntaxRestrictions,
            ...Object.entries(dbBoundaryRestrictions).flatMap(
              ([owner, restrictions]) => (owner === home ? [] : restrictions),
            ),
          ],
        },
      })),
    ];
  }),
  {
    files: ['packages/db/src/**/*.ts'],
    ignores: [
      'packages/db/src/raw-rows.ts',
      'packages/db/src/**/testing*.ts',
      'packages/db/src/**/*-testing.ts',
      'packages/db/src/**/*-fixture.ts',
      'packages/db/src/**/*.test.ts',
      'packages/db/src/**/*.test-support.ts',
    ],
    plugins: { 'db-native-rows': dbNativeRowsPlugin },
    rules: { 'db-native-rows/require-query': 'error' },
  },
  {
    files: ['apps/web/src/app/**/route.ts', 'apps/web/src/app/**/actions.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...appImportRestrictions,
            { ...processEdgeImport, allowImportNames: ['processRoute'] },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...repoSyntaxRestrictions,
        ...processEdgeLoads,
      ],
    },
  },
  // ISSUE-7: exactly one module per app reads process.env or globalThis,
  // the process edge that builds the app (web: server/process-app.ts;
  // realtime: start.ts). Everything else receives what it needs as an
  // argument. Tests may read their test-service URLs; they may not write.
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'apps/realtime/src/**/*.ts'],
    ignores: [
      'apps/web/src/server/process-app.ts',
      'apps/realtime/src/start.ts',
      // The instrumentation is a process entry: Next runs it per runtime, and
      // it dispatches on NEXT_RUNTIME before importing any edge module.
      'apps/web/src/instrumentation.ts',
      // ADR 0037: the Sentry runtime configs are vendor-seam entries —
      // instrumentation loads them, and each reads only its own gate.
      'apps/web/src/features/telemetry/sentry.*.config.ts',
      '**/*.test.{ts,tsx}',
      '**/*.test-support.{ts,tsx}',
    ],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Read validated config from the app; only the process edge reads process.env.',
        },
        {
          object: 'Bun',
          property: 'env',
          message:
            'Read validated config from the app; only the process edge reads the environment.',
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'globalThis',
          message:
            'Receive resources as arguments; only the process edge reads globalThis.',
        },
      ],
    },
  },
  {
    files: [...purePackages, 'apps/web/src/features/**/model/**/*.{ts,tsx}'],
    rules: { 'no-restricted-globals': ['error', ...pureAmbientGlobals] },
  },
  {
    files: ['**/*.config.*'],
    rules: { 'no-console': 'off' },
  },
  // Unit tests run on a virtual clock (ADR 0164); integration and browser
  // suites drive real services and keep real time.
  {
    files: ['**/*.test.{ts,tsx}', '**/*.test-support.{ts,tsx}'],
    ignores: ['**/integration/**', '**/e2e/**'],
    plugins: { 'test-time': testTimePlugin },
    rules: { 'test-time/no-real-sleep': 'error' },
  },
  // ADR 0037's vendor seam, declared last so it wins over every earlier
  // `no-restricted-imports` entry: the Sentry adapters (web's telemetry
  // feature, realtime's telemetry module) and the build wrapper are the
  // only app modules that may import the SDK.
  {
    files: [
      'apps/web/src/features/telemetry/**/*.ts',
      'apps/web/next.config.ts',
      'apps/realtime/src/telemetry/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: appImportRestrictions }],
    },
  },
  // State is one closed union with total transitions
  // (docs/architecture/rules.md): a `switch` over a union names every member,
  // and a `default` does not stand in for one, so a new state fails lint at
  // each place that has not decided what it means. `assertNever` from
  // `@daisy/protocol` is the `default` for a value that arrives unvalidated.
  // The rule needs types, so it runs on the sources every workspace
  // `tsconfig.json` owns.
  {
    files: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: typedRules,
  },
  {
    files: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    plugins: { daisy: daisyPlugin },
    rules: { 'daisy/no-non-null-assertion': 'error' },
  },
];
