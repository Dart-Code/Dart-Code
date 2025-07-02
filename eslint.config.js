import eslint from '@eslint/js';
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
	eslint.configs.recommended,
	tseslint.configs.recommendedTypeChecked,
	tseslint.configs.stylisticTypeChecked,
	{
		ignores: [
			".vscode-test/**",
			"**/test_projects/**",
			"eslint.config.js",
			"lints/**",
			"media/**",
			"node_modules/**",
			"out/**",
			"webpack.config.js",
		],
	},
	{
		files: ["**/*.js", "**/*.ts"],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
]);
