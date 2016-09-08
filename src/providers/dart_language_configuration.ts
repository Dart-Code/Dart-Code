"use strict";

import { LanguageConfiguration, IndentAction } from "vscode";

export class DartLanguageConfiguration implements LanguageConfiguration {
	onEnterRules = [
		{
			// Triple-slash with space.
			beforeText: /^\s*\/\/\/ /,
			action: { indentAction: IndentAction.None, appendText: '/// ' }
		},
		{
			// Triple-slash without space.
			beforeText: /^\s*\/\/\//,
			action: { indentAction: IndentAction.None, appendText: '///' }
		},
		{
			// When between "/** | */" this puts a " * " in but also pushes the "*/" down to next line.
			beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
			afterText: /^\s*\*\/$/,
			action: { indentAction: IndentAction.IndentOutdent, appendText: ' * ' }
		},
		{
			// When after "/**" will put a " * " in (like above, but where there's no "*/" to push down).
			beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
			action: { indentAction: IndentAction.None, appendText: ' * ' }
		},
		{
			// Continue " * " when on a line already start with this.
			beforeText: /^(\t|(\ \ ))*\ \*(\ ([^\*]|\*(?!\/))*)?$/,
			action: { indentAction: IndentAction.None, appendText: '* ' }
		},
		{
			// After "*/" we need to remove the indent.
			beforeText: /^(\t|(\ \ ))*\ \*\/\s*$/,
			action: { indentAction: IndentAction.None, removeText: 1 }
		},
	];
}
