import { IndentAction, LanguageConfiguration, OnEnterRule } from "vscode";
import { config } from "../config";

export class DartLanguageConfiguration implements LanguageConfiguration {
	private readonly doubleSlashRules: OnEnterRule[] = [
		{
			// Double-slash with space.
			action: { indentAction: IndentAction.None, appendText: "// " },
			beforeText: /^\s*\/\/ /,
		},
		{
			// Double-slash without space.
			action: { indentAction: IndentAction.None, appendText: "//" },
			beforeText: /^\s*\/\//,
		},
	];
	private readonly tripleSlashRules: OnEnterRule[] = [
		{
			// Triple-slash with space.
			action: { indentAction: IndentAction.None, appendText: "/// " },
			beforeText: /^\s*\/\/\/ /,
		},
		{
			// Triple-slash without space.
			action: { indentAction: IndentAction.None, appendText: "///" },
			beforeText: /^\s*\/\/\//,
		},
	];
	private readonly slashStarRules: OnEnterRule[] = [
		{
			// When between "/** | */" this puts a " * " in but also pushes the "*/" down to next line.
			action: { indentAction: IndentAction.IndentOutdent, appendText: " * " },
			afterText: /^\s*\*\/$/,
			beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
		},
		{
			// When after "/**" will put a " * " in (like above, but where there's no "*/" to push down).
			action: { indentAction: IndentAction.None, appendText: " * " },
			beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
		},
		{
			// Continue " * " when on a line already start with this.
			action: { indentAction: IndentAction.None, appendText: "* " },
			beforeText: /^(\t|(\ \ ))*\ \*(\ ([^\*]|\*(?!\/))*)?$/,
		},
		{
			// After "*/" we need to remove the indent.
			action: { indentAction: IndentAction.None, removeText: 1 },
			beforeText: /^(\t|(\ \ ))*\ \*\/\s*$/,
		},
	];

	public get onEnterRules() {
		let rules: OnEnterRule[] = [];

		if (config.automaticCommentSlashes !== "none")
			rules = rules.concat(this.tripleSlashRules);
		if (config.automaticCommentSlashes === "all")
			rules = rules.concat(this.doubleSlashRules);
		rules = rules.concat(this.slashStarRules);

		return rules;
	}
}
