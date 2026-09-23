import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextVitals from 'eslint-config-next/core-web-vitals';
import betterTailwind from 'eslint-plugin-better-tailwindcss';
import { getDefaultSelectors } from 'eslint-plugin-better-tailwindcss/defaults';

/**
 * Shared between the repo-wide `no-restricted-syntax` entry and the
 * ambient-time exemption below, so the two copies can't drift: AGENTS.md's
 * explicit-exports rule applies to every workspace source file, with no
 * exception.
 */
const exportStarRestriction = {
  selector: 'ExportAllDeclaration',
  message:
    'Use named re-exports, not `export *` (AGENTS.md: explicit exports, no barrels).',
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
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            'Inject a clock instead of reading the current time directly.',
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
          message:
            'Inject an identity generator instead of creating an ID directly.',
        },
        exportStarRestriction,
        ...processMutationRestrictions,
      ],
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
      complexity: ['error', 10],
      'max-lines': [
        'error',
        { max: 300, skipBlankLines: true, skipComments: true },
      ],
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
            '!riteway/bun',
            'node:*',
            '@adobe/*',
            '@daisy/*/src/*',
            '@daisy/db',
            '@daisy/redis',
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
      'no-restricted-imports': [
        'error',
        { patterns: ['@adobe/*', '@daisy/*/src/*'] },
      ],
    },
  },
  {
    files: ['scripts/**/*.ts'],
    rules: {
      // Repo tooling is procedural CLI glue; application source remains subject
      // to the stricter complexity and size ratchets.
      complexity: ['error', 15],
      'max-lines': [
        'error',
        { max: 400, skipBlankLines: true, skipComments: true },
      ],
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
      '**/integration/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': ['error', exportStarRestriction],
    },
  },
  // Integration setup may read ambient time, but app suites still never
  // mutate process-wide state (the exemption above replaced the list).
  {
    files: ['apps/**/integration/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        exportStarRestriction,
        ...processMutationRestrictions,
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
    files: ['**/*.config.*'],
    rules: { 'no-console': 'off' },
  },
];
