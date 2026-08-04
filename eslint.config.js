import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // `frontendishere/` is a vendored Next.js design reference (with its own
  // toolchain + `.next` build cache), not our shipping code — never lint it.
  { ignores: ['dist', 'src-tauri/target', 'node_modules', 'frontendishere'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      // react-refresh ships a proper flat-object config; extend it directly.
      reactRefresh.configs.vite,
    ],
    // react-hooks v7 configs still use the legacy `plugins: [...]` array shape,
    // which flat config rejects. Register the plugin as an object manually and
    // pull in just its (format-agnostic) recommended rules map.
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // react-hooks v7's `recommended` bundles the experimental react-compiler
      // rule set. We keep the classic, high-value rules on (`rules-of-hooks`,
      // `exhaustive-deps`) but disable the compiler rules: this project hasn't
      // adopted the React Compiler, and each of these fires on correct,
      // intentional code — a first-child-only `cloneElement` wire, a DPR ref
      // snapshot read during render, reduced-motion `setState` in an effect.
      // Turning them on would mean rewriting working UI to satisfy a compiler
      // we don't run. Revisit if/when we enable the compiler.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      // Underscore-prefixed args/vars/catch bindings are a deliberate
      // "intentionally unused" signal — honour that convention.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
)
