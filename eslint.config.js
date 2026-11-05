import eslint from '@eslint/js';
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
	eslint.configs.recommended,
	tseslint.configs.recommendedTypeChecked, // TODO(dantup): Consider strict.
	tseslint.configs.stylisticTypeChecked,
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
			reportUnusedDisableDirectives: true,
		},
		plugins: {
			"dart-code": {
				rules: {
					// Disallows accessing `globalState`, `workspaceState`, `globalStorageUri`, or `storageUri`
					// directly on VS Code's `ExtensionContext`. All extension state and storage access should go
					// through the `Context` wrapper in `src/shared/vscode/workspace.ts` (`globalState`, `profileState`,
					// `workspaceState`, and `extensionStorageUri`) so that cross-profile vs. per-profile vs. per-workspace
					// scoping is enforced consistently.
					"no-extension-context-state": {
						create: (ctx) => ({
							"MemberExpression[property.name=/^(globalState|workspaceState|globalStorageUri|storageUri)$/]": (node) => {
								if (ctx.sourceCode.parserServices?.getTypeAtLocation(node.object).getSymbol()?.getName() === "ExtensionContext")
									ctx.report({ node: node.property, message: `Do not access ${node.property.name} on ExtensionContext directly; use the Context wrapper instead.` });
							},
						}),
					},
				},
			},
		},
		rules: {
			"dart-code/no-extension-context-state": "error",
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
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/require-await": "off",
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
			"@typescript-eslint/class-literal-property-style": "off",
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
			"@typescript-eslint/no-empty-function": "off",
			"@typescript-eslint/no-inferrable-types": "warn",
			"@typescript-eslint/no-misused-promises": [
				"error",
				{
					"checksVoidReturn": false
				}
			],
			"@typescript-eslint/no-shadow": "error",
			"@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
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
	{
		// Allow tests to import anything.
		files: ["src/test/**/*.ts"],
		rules: {
			"no-restricted-imports": "off",
		},
	},
]);
