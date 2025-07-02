import eslint from '@eslint/js';
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
	eslint.configs.recommended,
	tseslint.configs.recommendedTypeChecked, // TODO(dantup): Consider strict.
	// tseslint.configs.stylisticTypeChecked,
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
			"@typescript-eslint/no-base-to-string": "off",
			"no-extra-boolean-cast": "off",
			"@typescript-eslint/no-duplicate-type-constituents": "off",
			"@typescript-eslint/no-empty-object-type": "off",
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-misused-promises": "off",
			"@typescript-eslint/no-redundant-type-constituents": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			"@typescript-eslint/no-unused-expressions": "off",
			"@typescript-eslint/no-unused-vars": "off",
			"@typescript-eslint/only-throw-error": "off",
			"@typescript-eslint/prefer-promise-reject-errors": "off",
			"@typescript-eslint/require-await": "off",
			"@typescript-eslint/restrict-template-expressions": "off",
			"@typescript-eslint/unbound-method": "off",
			"no-async-promise-executor": "off",
			"no-case-declarations": "off",
			"no-constant-binary-expression": "off",
			"no-empty": "off",
			"no-useless-escape": "off",
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
