// Root lint config for the non-workspace files: build scripts, ops scripts and
// this config itself. The web/ and apps/shared/ workspaces keep their own configs.
import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '.runtime/**',
      '.state/**',
      'web/**',
      'apps/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.node },
      sourceType: 'module'
    }
  }
]
