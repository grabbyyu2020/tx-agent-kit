/**
 * Code quality rules that apply broadly across the codebase.
 *
 * - Ban nested ternaries (readability)
 * - Ban require() in TypeScript (enforce ESM)
 * - Ban floating void expressions (error swallowing)
 * - Remove unused imports (auto-fixable)
 * - Enforce consistent code style (curly, shorthand, arrow callbacks, spread)
 * - Cap file length at 500 lines
 */
import { builtinRules } from 'eslint/use-at-your-own-risk'
import unusedImports from 'eslint-plugin-unused-imports'

// Core max-lines counting, with a message that tells agents how to fix it.
const coreMaxLines = builtinRules.get('max-lines')
const fileLengthPlugin = {
  meta: { name: 'file-length', version: '0.1.0' },
  rules: {
    'max-lines': {
      ...coreMaxLines,
      meta: {
        ...coreMaxLines.meta,
        messages: {
          exceed:
            'File has {{actual}} lines (max {{max}}; blank and comment-only lines excluded). ' +
            'Large files mix responsibilities and are hard to navigate and review. ' +
            'Split by responsibility: move a cohesive unit (a sub-component or hook, a use case, ' +
            'a group of related queries, shared types/schemas) into a sibling module that follows ' +
            "this layer's naming and boundaries, then import it here. " +
            'Avoid pass-through wrappers and long prop chains. ' +
            'Do not compress formatting, delete meaningful code or comments, raise the limit, ' +
            'add this file to the max-lines ignores in packages/tooling/eslint-config/code-quality.js, ' +
            'or disable the rule. If no sensible split exists, stop and ask the user.'
        }
      }
    }
  }
}

export const codeQualityConfig = [
  // ── Rule: Modern JS style + unused imports ────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['**/lib/api/generated/**/*.{ts,tsx}'],
    plugins: {
      'unused-imports': unusedImports
    },
    rules: {
      // Delegate unused-import detection to unused-imports plugin (auto-fixable).
      // Delegate unused-var detection to unused-imports wrapper to avoid
      // duplicate reports with @typescript-eslint/no-unused-vars.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      curly: 'error',
      'object-shorthand': 'error',
      'prefer-arrow-callback': ['error', { allowNamedFunctions: true }],
      'prefer-rest-params': 'error',
      'prefer-spread': 'error'
    }
  },

  // ── Rule: Ban nested ternaries ──────────────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [
      '**/lib/api/generated/**/*.{ts,tsx}',
      'packages/tooling/scaffold/**/*.{ts,tsx}'
    ],
    rules: {
      'no-nested-ternary': 'error'
    }
  },

  // Disable nested ternary check for generated API clients (Orval output)
  {
    files: [
      'apps/web/lib/api/generated/**/*.{ts,tsx}',
      'apps/mobile/lib/api/generated/**/*.{ts,tsx}'
    ],
    rules: {
      'no-nested-ternary': 'off'
    }
  },

  // ── Rule: Ban require() in TypeScript source ────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['scripts/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'error'
    }
  },

  // ── Rule: Ban floating void expressions ─────────────────────────────
  // void is used to silence no-floating-promises but swallows errors.
  // Use Effect.runFork, .catch(), or await instead.
  {
    files: ['packages/**/src/**/*.{ts,tsx}', 'apps/**/src/**/*.{ts,tsx}'],
    ignores: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.integration.test.ts',
      '**/*.integration.test.tsx',
      '**/test-*.ts',
      '**/test-*.tsx',
      'apps/api/src/server-lib.ts',
      'apps/api/src/openapi.ts',
      'apps/worker/src/index.ts',
      // Event-loop dispatcher: NOTIFY callbacks + backstop timer are inherently
      // fire-and-forget; the single-flight trigger never rejects.
      'apps/worker/src/dispatch/outbox-dispatcher.ts',
      'packages/testkit/src/command-entrypoints.ts',
      'packages/infra/observability/src/client.ts',
      'packages/tooling/scaffold/src/cli.ts'
    ],
    rules: {
      'no-void': ['error', { allowAsStatement: false }]
    }
  },

  // ── Rule: Cap file length at 500 lines ──────────────────────────────
  // Blank and comment-only lines do not count. Test and generated files are exempt.
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [
      '**/lib/api/generated/**/*.{ts,tsx}',
      '**/*.generated.ts',
      '**/*.test.{ts,tsx}'
    ],
    plugins: {
      'file-length': fileLengthPlugin
    },
    rules: {
      'file-length/max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }]
    }
  }
]
