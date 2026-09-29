// Flat config (ESLint 9). Deliberately warn-heavy rather than error-heavy for v0.2.0:
// the point of this stage is signal, not a clean board. Later stages tighten it.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "data/**",
      "docs/**",
      ".edexo-cache/**",
      "public/launcher.html",
      // Local screenshots, backups and one-off probes; never shipped, never imported.
      "build-artifacts/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // TypeScript already resolves identifiers; `no-undef` only produces false positives here.
      "no-undef": "off",

      // Signal we actually care about for the perf work in v0.4.0.
      "react-hooks/exhaustive-deps": "warn",

      // The codebase uses `catch { /* ignore */ }` and leading-underscore throwaways widely.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    // The server bundles to CJS and lazily `require()`s electron; that is deliberate.
    files: ["src/server/**/*.ts"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // Electron main/preload and build helpers are plain CommonJS Node scripts.
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    /*
      The build, release and probe scripts (linted since 2026-09-29; they were ignored, and 114 errors
      had piled up — 105 of them only Node's globals, undeclared for .mjs). Node globals; for .ts the
      same leniency as src, since TypeScript already resolves identifiers there.
    */
    files: ["scripts/**/*.{mjs,js,ts}"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["scripts/**/*.ts"],
    rules: { "no-undef": "off" },
  },
  {
    // The HUD overlays' plain browser script (no bundler): browser globals, plus the `module` check
    // it does at the bottom so tests can require it. Same leniency as src for throwaway catches.
    files: ["public/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, module: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  prettier,
);
