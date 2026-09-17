const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

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
];
