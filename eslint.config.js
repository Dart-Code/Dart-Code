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
			"src/debug/**", // This is legacy code going away soon.
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
		linterOptions: {
			// Temporarily ignore disable comments for rules that don't trigger.
			// We have a bunch of ignores for things like "no-unsafe-assignment" but
			// the rule is currently disabled below.
			reportUnusedDisableDirectives: false,
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
			// Temporary exclusions after tslint -> eslint migration
			"@typescript-eslint/no-base-to-string": "off",
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
			"no-extra-boolean-cast": "off",
			"no-useless-escape": "off",
			// End temporary exclusions
			"arrow-body-style": "error",
			"arrow-parens": [
				"error",
				"always"
			],
			"brace-style": [
				"error",
				"1tbs",
				{
					"allowSingleLine": true
				}
			],
			"camelcase": [
				"error",
				{
					"allow": ["child_process"]
				}
			],
			"id-blacklist": [
				"error",
				"any",
				"Number",
				"number",
				"String",
				"string",
				"Boolean",
				"boolean",
				"Undefined",
			],
			"complexity": "off",
			"constructor-super": "error",
			"curly": "off",
			"dot-notation": "error",
			"eol-last": "error",
			"eqeqeq": [
				"error",
				"always"
			],
			"guard-for-in": "error",
			"id-match": "error",
			"new-parens": "error",
			"no-bitwise": "error",
			"no-caller": "error",
			"no-cond-assign": "error",
			"no-debugger": "error",
			"no-empty": [
				"error",
				{
					"allowEmptyCatch": true
				}
			],
			"no-eval": "error",
			"no-multiple-empty-lines": "error",
			"no-new-wrappers": "error",
			"no-shadow": [
				"off",
				{
					"hoist": "all"
				}
			],
			"no-throw-literal": "error",
			"no-trailing-spaces": "error",
			"no-undef-init": "error",
			"no-underscore-dangle": [
				"error",
				{
					"allowAfterThis": true,
				}
			],
			"no-unsafe-finally": "error",
			"no-unused-labels": "error",
			"no-var": "error",
			"object-shorthand": "error",
			"one-var": [
				"error",
				"never"
			],
			"prefer-arrow-callback": [
				"error"
			],
			"prefer-const": "error",
			"quote-props": [
				"warn",
				"consistent-as-needed"
			],
			"spaced-comment": [
				"error",
				"always",
				{
					"markers": [
						"/"
					]
				}
			],
			"use-isnan": "error",
			"indent": [
				"error",
				"tab",
				{
					"FunctionDeclaration": {
						"parameters": "first"
					},
					"FunctionExpression": {
						"parameters": "first"
					},
					"SwitchCase": 1
				}
			],
			"quotes": [
				"error",
				"double",
				{
					"avoidEscape": true,
					"allowTemplateLiterals": true,
				}
			],
			"semi": [
				"error",
				"always"
			],
			"@typescript-eslint/array-type": [
				"error",
				{
					"default": "array-simple"
				}
			],
			"@typescript-eslint/consistent-type-definitions": "error",
			"@typescript-eslint/member-delimiter-style": [
				// TODO: Set this back to "error" when fixed.
				"off",
				{
					"multiline": {
						"delimiter": "semi",
						"requireLast": true
					},
					"singleline": {
						"delimiter": "semi",
						"requireLast": false
					}
				}
			],
			"@typescript-eslint/no-inferrable-types": "warn",
			"@typescript-eslint/no-misused-promises": [
				"error",
				{
					"checksVoidReturn": false
				}
			],
			"@typescript-eslint/prefer-for-of": "error",
			"@typescript-eslint/prefer-function-type": "error",
			"@typescript-eslint/prefer-includes": "warn",
			"@typescript-eslint/triple-slash-reference": [
				"error",
				{
					"path": "always",
					"types": "prefer-import",
					"lib": "always"
				}
			],
			"@typescript-eslint/unified-signatures": "error",
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
