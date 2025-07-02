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
		rules: {
			"no-restricted-properties": [
				"error",
				{
					"property": "fsPath"
				}, {
					"property": "fileName"
				}
			],
			"no-restricted-imports": ["error", {
				"patterns": [{
					"group": ["**/../extension/**"],
					"message": "Do not import extension code because the extension packing will mean duplicate definitions and state."
				},
				{
					"group": ["**/../debug/**"],
					"message": "Do not import debugger code because it is expected to run in another process."
				}]
			}],
		}
	},
	{
		// Block importing VS Code except for certain places.
		files: ["**/*.ts"],
		ignores: [
			"src/extension/**",
			"src/test/**",
			"**/vscode/**",
		],
		rules: {
			"no-restricted-imports": ["error", {
				// We need to re-include the patterns from above otherwise they will not be
				// applied to the bits that match this block.
				"patterns": [{
					"group": ["**/../extension/**"],
					"message": "Do not import extension code because the extension packing will mean duplicate definitions and state."
				},
				{
					"group": ["**/../debug/**"],
					"message": "Do not import debugger code because it is expected to run in another process."
				}],
				"paths": ["vscode"]
			}],
		},
	},
]);
