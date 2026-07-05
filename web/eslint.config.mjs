import next from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config for the Next.js app. Replaces the old `lint = tsc` alias.
 *
 * Composition: Next's core-web-vitals rules (pulls react, react-hooks,
 * jsx-a11y, import) + typescript-eslint recommended, then a type-aware block
 * that turns on the highest-value rules for this promise-heavy S3 codebase.
 *
 * Deliberate rule levels (see plan 019):
 *  - no-floating-promises: error — the one rule worth the type-aware cost here.
 *  - react-hooks/exhaustive-deps: warn — the Library modal's Ref-mirror pattern
 *    trips it on purpose; a blanket error would force unrelated rewrites.
 *  - no-explicit-any: warn — matches the repo's "no `any` without justification".
 */
export default tseslint.config(
  { ignores: ['.next/', 'node_modules/', 'next-env.d.ts'] },
  ...next,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      // react-hooks v6 (react-compiler era) ships several aggressive rules that
      // flag intentional patterns here — reset-on-open effects, derived-state
      // sync, the Library modal's Ref mirrors. Keep them as `warn` for now.
      // TODO(ratchet): drive these to zero and promote to `error` in a pass.
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
);
