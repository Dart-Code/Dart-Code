import { Disposable, IndentAction, LanguageConfiguration, languages, OnEnterRule, workspace } from "vscode";
import { config } from "../config";

export class DartLanguageConfiguration implements LanguageConfiguration {
	public static register(language: string): Disposable {
		// Track the current active subscription for the language config.
		let subscription: Disposable | undefined;

		// Helper to register the current language config, unregistering
		// any existing config first.
		const register = () => {
			subscription?.dispose();
			subscription = languages.setLanguageConfiguration(language, new DartLanguageConfiguration());
		};

		// Watch the config and re-register any time the automaticCommentSlashes setting changes.
		const configWatcher = workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("dart.automaticCommentSlashes"))
				register();
		});

		// Perform initial registration.
		register();

		// Return a wrapper that disposes both the config watcher and the current active
		// config.
		return {
			dispose: () => {
				configWatcher.dispose();
				subscription?.dispose();
			},
		};
	}

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
	// When double-slash is disabled, we still want to be able to add newlines
	// in existing comments and have them include the comment markers.
	private readonly betweenDoubleSlashRules: OnEnterRule[] = [
		{
			// Double-slash with space when there's already an existing space after
			// so we don't need to insert one.
			action: { indentAction: IndentAction.None, appendText: "//" },
			afterText: / .*$/,
			beforeText: /^\s*\/\//,
		},
		{
			// Double-slash with space when there's not already an existing space after.
			action: { indentAction: IndentAction.None, appendText: "// " },
			afterText: /[^ ]+$/,
			beforeText: /^\s*\/\/ /,
		},
		{
			// Double-slash without space.
			action: { indentAction: IndentAction.None, appendText: "//" },
			afterText: /.+$/,
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
			beforeText: /^\s*\/\*\*(?!\/)([^*]|\*(?!\/))*$/,
		},
		{
			// When after "/**" will put a " * " in (like above, but where there's no "*/" to push down).
			action: { indentAction: IndentAction.None, appendText: " * " },
			beforeText: /^\s*\/\*\*(?!\/)([^*]|\*(?!\/))*$/,
		},
		{
			// Continue " * " when on a line already start with this.
			action: { indentAction: IndentAction.None, appendText: "* " },
			beforeText: /^(\t|( {2}))* \*( ([^*]|\*(?!\/))*)?$/,
		},
		{
			// After "*/" we need to remove the indent.
			action: { indentAction: IndentAction.None, removeText: 1 },
			beforeText: /^(\t|( {2}))* \*\/\s*$/,
		},
	];
	private readonly tripleQuoteRules: OnEnterRule[] = [
		{
			// Remove all indent after starting a multiline string.
			action: { indentAction: IndentAction.None, removeText: 80 },
			beforeText: /('''|""")$/,
		},
	];

	public get onEnterRules() {
		let rules: OnEnterRule[] = [];

		if (config.automaticCommentSlashes !== "none")
			rules = rules.concat(this.tripleSlashRules);
		if (config.automaticCommentSlashes === "all")
			rules = rules.concat(this.doubleSlashRules);
		else
			rules = rules.concat(this.betweenDoubleSlashRules);
		rules = rules.concat(this.slashStarRules);
		rules = rules.concat(this.tripleQuoteRules);

		return rules;
	}
}
