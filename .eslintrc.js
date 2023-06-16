// Try to keep synced with Flutter extension!
module.exports = {
	"env": {
		"es6": true,
		"node": true
	},
	"extends": [
		"plugin:@typescript-eslint/recommended",
		"plugin:@typescript-eslint/recommended-requiring-type-checking",
	],
	"parser": "@typescript-eslint/parser",
	"parserOptions": {
		"project": "tsconfig.json",
		"sourceType": "module"
	},
	"ignorePatterns": [
		".eslintrc.js",
		"webpack.config.js",
		"lints/**/*.*",
		"out/**/*.*",
	],
	"plugins": [
		"@typescript-eslint",
		"@typescript-eslint/tslint"
	],
	"rules": {
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
		"comma-dangle": [
			"error",
			"always-multiline"
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
		"id-match": "error",
		"import/order": "off",
		"max-classes-per-file": "off",
		"max-len": "off",
		"new-parens": "error",
		"no-bitwise": "error",
		"no-caller": "error",
		"no-cond-assign": "error",
		"no-console": "off",
		"no-debugger": "error",
		"no-empty": [
			"error",
			{
				"allowEmptyCatch": true
			}
		],
		"no-eval": "error",
		"no-fallthrough": "off",
		"no-invalid-this": "off",
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
		// This triggers on things like "frame?.load(session, uri)"
		"no-unused-expressions": "off",
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
			// TODO: Set back to error when fixed.
			"off",
			"consistent-as-needed"
		],
		"radix": "off",
		"space-before-function-paren": "off",
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
		"valid-typeof": "off",
		"@typescript-eslint/array-type": [
			"error",
			{
				"default": "array-simple"
			}
		],
		"@typescript-eslint/ban-types": [
			"error",
			{
				"types": {
					"Function": null,
				}
			}
		],
		"@typescript-eslint/consistent-type-definitions": "error",
		"@typescript-eslint/explicit-function-return-type": "off",
		// "@typescript-eslint/explicit-member-accessibility": [
		// 	"error",
		// 	{
		// 		"accessibility": "explicit"
		// 	}
		// ],
		// TODO: Enable this when fixed
		"@typescript-eslint/explicit-module-boundary-types": "off",
		"@typescript-eslint/indent": [
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
		"@typescript-eslint/interface-name-prefix": "off",
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
		"@typescript-eslint/no-empty-interface": "off",
		"@typescript-eslint/no-namespace": "off",
		"@typescript-eslint/no-explicit-any": "off",
		// TODO: Re-enable this when fixed.
		"@typescript-eslint/no-unsafe-assignment": "off",
		// TODO: Re-enable this when fixed.
		"@typescript-eslint/no-unsafe-call": "off",
		// TODO: Re-enable this when fixed.
		"@typescript-eslint/no-unsafe-member-access": "off",
		// TODO: Re-enable this when fixed.
		"@typescript-eslint/no-unsafe-return": "off",
		// TODO: Re-enable this when fixed.
		"@typescript-eslint/no-inferrable-types": "off",
		"@typescript-eslint/no-misused-promises": [
			"error",
			{
				"checksVoidReturn": false
			}
		],
		// TODO: Re-enable this when fixed.
		"@typescript-eslint/no-non-null-assertion": "off",
		"@typescript-eslint/no-parameter-properties": "off",
		// TODO: Re-enable this when fixed.
		"@typescript-eslint/no-unused-vars": "off",
		"@typescript-eslint/no-use-before-define": "off",
		"@typescript-eslint/prefer-for-of": "error",
		"@typescript-eslint/prefer-function-type": "error",
		// TODO: Re-enable this when fixed.
		"@typescript-eslint/prefer-includes": "off",
		// TODO: Enable this when fixed
		"@typescript-eslint/restrict-template-expressions": "off",
		// TODO: Re-enable this when fixed.
		"@typescript-eslint/require-await": "off",
		"@typescript-eslint/quotes": [
			"error",
			"double",
			{
				"avoidEscape": true,
				"allowTemplateLiterals": true,
			}
		],
		"@typescript-eslint/semi": [
			"error",
			"always"
		],
		"@typescript-eslint/triple-slash-reference": [
			"error",
			{
				"path": "always",
				"types": "prefer-import",
				"lib": "always"
			}
		],
		"@typescript-eslint/unbound-method": "off",
		"@typescript-eslint/unified-signatures": "error",
		"@typescript-eslint/tslint/config": [
			"error",
			{
				"rules": {
					"disallow-fspath": true,
					"disallow-importing-non-shared-code": true,
					"disallow-vscode": true,
					"import-spacing": true,
					"object-literal-sort-keys": true,
					"whitespace": [
						true,
						"check-branch",
						"check-decl",
						"check-operator",
						"check-separator",
						"check-type",
						"check-typecast"
					]
				},
				"rulesDirectory": [
					"lints/"
				]
			}
		]
	}
	// TODO: no unused expression
	// "max-line-length": false,
	// "ordered-imports": false,
	// "no-shadowed-variable": false
};
