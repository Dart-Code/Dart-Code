"use strict";

import { LanguageConfiguration, IndentAction } from "vscode";

export class DartLanguageConfiguration implements LanguageConfiguration {
	onEnterRules = [
		{
			beforeText: /^\s*\/\/\/ /,
			action: { indentAction: IndentAction.None, appendText: '/// ' }
		},
		{
			beforeText: /^\s*\/\/\//,
			action: { indentAction: IndentAction.None, appendText: '///' }
		}
	];
}
