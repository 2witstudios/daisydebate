import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextVitals from 'eslint-config-next/core-web-vitals';

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
  {
    files: [
      'packages/clock/**/*.ts',
      'packages/observability/**/*.ts',
      'scripts/**/*.ts',
      '**/integration/**/*.ts',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['**/*.config.*'],
    rules: { 'no-console': 'off' },
  },
];
