const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

// The bare specifier drags lodash's whole CommonJS monolith into every bundle for the handful of
// helpers we actually use. A deep path bundles only that helper.
const lodashImport = {
	name: "lodash",
	message:
		"Import the single method instead, e.g. `import uniq from \"lodash/uniq\"`, so the whole library does not end up in the bundle.",
	allowTypeImports: true,
};

// Only the entry point imports the editor's API as a value; it hands it to util/host as the
// extension activates. Every other file takes its types from `vscode` and its calls from host(),
// which is what lets the unit tests load it with no editor and no stand-in for one.
const vscodeImport = {
	name: "vscode",
	message:
		"Use `import type * as vscode from \"vscode\"` for types and `host()` from util/host for calls. Only src/extension.ts imports the API itself.",
	allowTypeImports: true,
};

module.exports = [
	{
		ignores: ["dist/**", "out/**", "out-test/**", "out-test-webview/**", "node_modules/**"],
	},
	{
		files: ["src/**/*.ts", "webviewsrc/**/*.ts"],
		plugins: {
			"@typescript-eslint": tsPlugin,
		},
		languageOptions: {
			parser: tsParser,
			ecmaVersion: 2022,
			sourceType: "module",
		},
		rules: {
			curly: "error",
			eqeqeq: "error",
			"no-throw-literal": "error",
			semi: "error",
			"no-duplicate-imports": "error",
			"no-restricted-imports": ["error", { paths: [lodashImport] }],
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
			],
		},
	},
	{
		files: ["src/**/*.ts", "webviewsrc/**/*.ts"],
		ignores: ["src/test/**"],
		languageOptions: {
			parser: tsParser,
			ecmaVersion: 2022,
			sourceType: "module",
			parserOptions: {
				project: ["./tsconfig.json"],
				tsconfigRootDir: __dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-floating-promises": ["error", { checkThenables: true }],
			"@typescript-eslint/no-misused-promises": "error",
		},
	},
	{
		files: ["src/**/*.ts"],
		ignores: ["src/test/**"],
		rules: {
			"@typescript-eslint/no-explicit-any": "warn",
		},
	},
	{
		files: ["src/**/*.ts"],
		ignores: ["src/test/**", "src/extension.ts"],
		rules: {
			"no-restricted-imports": ["error", { paths: [lodashImport, vscodeImport] }],
		},
	},
	// The release scripts and the build config run on every push to main and every pull request,
	// and used to be the one part of the tree nothing linted. Same style rules as the extension;
	// plain CommonJS, so no TypeScript parser.
	{
		files: ["scripts/**/*.js", "webpack.config.js", "eslint.config.cjs"],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "commonjs",
		},
		rules: {
			curly: "error",
			eqeqeq: "error",
			"no-throw-literal": "error",
			semi: "error",
			"no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
			],
		},
	},
];
