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
			// The bare specifier drags lodash's whole CommonJS monolith into every bundle for the
			// handful of helpers we actually use. A deep path bundles only that helper.
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "lodash",
							message:
								"Import the single method instead, e.g. `import uniq from \"lodash/uniq\"`, so the whole library does not end up in the bundle.",
							allowTypeImports: true,
						},
					],
				},
			],
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
