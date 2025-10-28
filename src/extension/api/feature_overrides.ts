import * as vs from "vscode";
import { fsPath, isWithinPathOrEqual } from "../../shared/utils/fs";

interface FeatureOverrideRule<TOptions> {
	folders: vs.Uri[];
	options: TOptions;
}

/// Manager for feature overrides that can be applied per-folder/project.
///
/// Rules are stored in order and the latest matching rule with an explicit option wins.
///
/// @template TOptions The type of options that can be overridden (properties should be optional settings/flags).
export class FeatureOverrideManager<TOptions> {
	private rules: Array<FeatureOverrideRule<TOptions>> = [];
	private onDidChangeEmitter = new vs.EventEmitter<void>();
	public readonly onDidChange = this.onDidChangeEmitter.event;

	public addOverride(folders: vs.Uri[], options: TOptions): vs.Disposable {
		const rule: FeatureOverrideRule<TOptions> = { folders, options };
		this.rules.push(rule);
		this.onDidChangeEmitter.fire();

		return new vs.Disposable(() => {
			const index = this.rules.indexOf(rule);
			if (index !== -1) {
				this.rules.splice(index, 1);
				this.onDidChangeEmitter.fire();
			}
		});
	}

	/// Computes the effective override options for a given URI.
	///
	/// Iterates through all rules in order, and for each matching rule, applies any
	/// explicit (non-undefined) option values. Later rules override earlier ones.
	///
	/// @param uri The URI of the document/folder/project to check.
	///
	/// @returns The computed override options (may contain undefined values for options that weren't overridden).
	public getOverrides(uri: vs.Uri): Partial<TOptions> {
		const resourcePath = fsPath(uri);
		const result: Partial<TOptions> = {};

		// Iterate through rules in order, latest match wins
		for (const rule of this.rules) {
			// Check if resource is within any of the rule's folders
			const matches = rule.folders.some((folder) => {
				const folderPath = fsPath(folder);
				return isWithinPathOrEqual(resourcePath, folderPath);
			});

			if (matches) {
				// Only update properties that have explicit values (not undefined)
				for (const key in rule.options) {
					if (Object.prototype.hasOwnProperty.call(rule.options, key)) {
						const value = rule.options[key];
						if (value !== undefined) {
							result[key as keyof TOptions] = value;
						}
					}
				}
			}
		}

		return result;
	}

	/// Clears all override rules.
	///
	/// This is used for testing to ensure clean state between tests.
	public clear(): void {
		if (this.rules.length > 0) {
			this.rules = [];
			this.onDidChangeEmitter.fire();
		}
	}
}
