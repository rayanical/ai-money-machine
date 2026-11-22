import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'views/relationships/vendor/**'] },
  js.configs.recommended,
  { files: ['**/*.{js,mjs,cjs}'], languageOptions: { globals: globals.node } },
  { files: ['deals/src/**/*.js'], languageOptions: { globals: globals.browser } },
  {
    files: ['views/relationships/app.js'],
    languageOptions: { globals: { ...globals.browser, d3: 'readonly', GraphCore: 'readonly' } },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: tseslint.configs.recommended,
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
)
