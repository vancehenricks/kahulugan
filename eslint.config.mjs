import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import pluginImport from 'eslint-plugin-import';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/', 'dist/', 'build/', '.next/', 'client/dist/'],
  },
  {
    files: ['**/*.{js,mjs,cjs,jsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      import: pluginImport,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
    },
  },
  js.configs.recommended,
  eslintConfigPrettier,
];
