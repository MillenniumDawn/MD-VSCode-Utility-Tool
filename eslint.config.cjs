const tsParser = require("@typescript-eslint/parser");

module.exports = [
	{
		ignores: ["dist/**", "out/**", "node_modules/**"],
	},
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parser: tsParser,
			ecmaVersion: 2015,
			sourceType: "module",
		},
		rules: {
			curly: "warn",
			eqeqeq: "warn",
			"no-throw-literal": "warn",
			semi: "warn",
		},
	},
];
