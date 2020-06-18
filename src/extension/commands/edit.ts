import * as vs from "vscode";
import { dartRecommendedConfig, openSettingsAction } from "../../shared/constants";
import { firstEditorColumn, showCode } from "../../shared/vscode/utils";

export class EditCommands implements vs.Disposable {
	private commands: vs.Disposable[] = [];

	constructor() {
		this.commands.push(
			vs.commands.registerCommand("_dart.jumpToLineColInUri", this.jumpToLineColInUri, this),
			vs.commands.registerCommand("_dart.showCode", showCode, this),
			vs.commands.registerCommand("dart.writeRecommendedSettings", this.writeRecommendedSettings, this),
		);
	}

	private async jumpToLineColInUri(uri: vs.Uri, lineNumber?: number, columnNumber?: number, inOtherEditorColumn?: boolean) {
		if (!uri || uri.scheme !== "file")
			return;

		// When navigating while using the inspector, we don't expect this file to replace
		// the inspector tab, so we always target a column that's showing an editor.
		const column = inOtherEditorColumn
			? firstEditorColumn() || vs.ViewColumn.Beside
			: vs.ViewColumn.Active;

		const doc = await vs.workspace.openTextDocument(uri);
		const editor = await vs.window.showTextDocument(doc, column, inOtherEditorColumn);
		if (lineNumber && columnNumber) {
			const line = doc.lineAt(lineNumber > 0 ? lineNumber - 1 : 0);
			const firstChar = line.range.start.translate({ characterDelta: line.firstNonWhitespaceCharacterIndex });
			showCode(editor, line.range, line.range, new vs.Range(firstChar, firstChar));
		}
	}

	private async writeRecommendedSettings() {
		const topLevelConfig = vs.workspace.getConfiguration("", null);
		const dartLanguageConfig = topLevelConfig.inspect("[dart]");
		const existingConfig = dartLanguageConfig ? dartLanguageConfig.globalValue : undefined;
		const newValues = Object.assign({}, dartRecommendedConfig, existingConfig);
		await topLevelConfig.update("[dart]", newValues, vs.ConfigurationTarget.Global);

		const action = await vs.window.showInformationMessage(
			"Recommended settings were written to the [dart] section of your global settings file",
			openSettingsAction,
		);

		if (action === openSettingsAction)
			await vs.commands.executeCommand("workbench.action.openSettingsJson");
	}

	public dispose(): any {
		for (const command of this.commands)
			command.dispose();
	}
}
