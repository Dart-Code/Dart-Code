import * as vs from "vscode";
import { dartRecommendedConfig, openSettingsAction } from "../../shared/constants";
import { getActiveRealFileEditor } from "../../shared/vscode/editors";
import { firstEditorColumn, showCode } from "../../shared/vscode/utils";
import { writeToPseudoTerminal } from "../utils/vscode/terminals";

export class EditCommands implements vs.Disposable {
	private commands: vs.Disposable[] = [];

	constructor() {
		this.commands.push(
			vs.commands.registerCommand("_dart.jumpToLineColInUri", this.jumpToLineColInUri.bind(this)),
			vs.commands.registerCommand("_dart.showCode", showCode),
			vs.commands.registerCommand("dart.writeRecommendedSettings", this.writeRecommendedSettings.bind(this)),
			vs.commands.registerCommand("dart.printSelectionToTerminal", this.printSelectionToTerminal.bind(this)),
			vs.commands.registerCommand("dart.toggleLineComment", this.toggleLineComment.bind(this)),
			vs.commands.registerCommand("dart.toggleDartdocComment", this.toggleDartdocComment.bind(this)),
			vs.commands.registerCommand("dart.sortMembers", () => this.runCodeAction("source.sortMembers")),
			vs.commands.registerCommand("dart.addCommentsToCode", this.addCommentsToCode.bind(this)),
		);
	}

	private async runCodeAction(action: string) {
		return vs.commands.executeCommand("editor.action.codeAction", { kind: action, apply: "ifSingle" });
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
		if (lineNumber) {
			const line = doc.lineAt(lineNumber > 0 ? lineNumber - 1 : 0);
			if (!columnNumber || columnNumber > line.range.end.character)
				columnNumber = line.firstNonWhitespaceCharacterIndex;
			else if (columnNumber > 0) {
				columnNumber--;
			}
			const char = line.range.start.translate({ characterDelta: columnNumber });
			showCode(editor, line.range, line.range, new vs.Range(char, char));
		}
	}

	private async writeRecommendedSettings(options?: { showNotification?: boolean }) {
		const topLevelConfig = vs.workspace.getConfiguration("", null);
		const dartLanguageConfig = topLevelConfig.inspect("[dart]");
		const existingConfig = dartLanguageConfig ? dartLanguageConfig.globalValue : undefined;
		const newValues = Object.assign({}, dartRecommendedConfig, existingConfig);
		await topLevelConfig.update("[dart]", newValues, vs.ConfigurationTarget.Global);

		if (options?.showNotification !== false) {
			const action = await vs.window.showInformationMessage(
				"Recommended settings were written to the [dart] section of your global settings file",
				openSettingsAction,
			);

			if (action === openSettingsAction)
				await vs.commands.executeCommand("workbench.action.openSettingsJson", { revealSetting: { key: "[dart]" } });
		}
	}

	private async printSelectionToTerminal() {
		const editor = getActiveRealFileEditor();
		const selection = editor?.selection;
		const text = editor?.document?.getText(selection);

		if (text) {
			writeToPseudoTerminal([text]);
		}
	}

	private toggleDartdocComment() {
		return this.toggleLineComment(true);
	}

	private async toggleLineComment(onlyDartdoc = false) {
		const editor = getActiveRealFileEditor();
		if (!editor?.selections.length)
			return;
		const document = editor.document;
		const selections = editor.selections;

		// Track the prefix that matches all lines in all selections.
		// If any line does not start with `///` then it cannot be TRIPLE.
		// If any line does not start with '//' then it cannot be DOUBLE.
		// We start from the highest and work down as we find lines that don't match.
		let commonPrefix: "NONE" | "DOUBLE" | "TRIPLE" = "TRIPLE";

		check: {
			for (const selection of selections) {
				for (let lineNumber = selection.start.line; lineNumber <= selection.end.line; lineNumber++) {
					const line = document.lineAt(lineNumber);
					// Skip over blank lines, as they won't have comment markers and shouldn't
					// influence which common prefix we find.
					if (line.isEmptyOrWhitespace)
						continue;

					const text = line.text.trim();
					if (commonPrefix === "TRIPLE" && !text.startsWith("///"))
						commonPrefix = text.startsWith("//") ? "DOUBLE" : "NONE";
					else if (commonPrefix === "DOUBLE" && !text.startsWith("//"))
						commonPrefix = "NONE";

					// Any time we hit NONE, we can bail out.
					if (commonPrefix === "NONE")
						break check;
				}
			}
		}

		if (onlyDartdoc) {
			switch (commonPrefix) {
				case "NONE":
					// If no prefix, insert triples.
					await this.prefixLines(editor, selections, "/// ");
					break;
				case "DOUBLE":
					// If already double, just add the additional one slash.
					await this.prefixLines(editor, selections, "/");
					break;
				case "TRIPLE":
					// If already triple, remove slashes.
					await this.removeLinePrefixes(editor, selections, ["/// ", "///"]);
					break;
			}
		} else {
			switch (commonPrefix) {
				case "NONE":
					// If no prefix, insert doubles.
					await this.prefixLines(editor, selections, "// ");
					break;
				case "DOUBLE":
					// If already double, add an additional slash to make triple.
					await this.prefixLines(editor, selections, "/");
					break;
				case "TRIPLE":
					// If already triple, remove slashes.
					await this.removeLinePrefixes(editor, selections, ["/// ", "///"]);
					break;
			}
		}
	}

	private async prefixLines(editor: vs.TextEditor, selections: readonly vs.Selection[], prefix: string) {
		const document = editor.document;
		// In case we have overlapping selections, keep track of lines we've done.
		const doneLines = new Set<number>();

		// Find the minimum indent, so we can insert all slashes at the same level even if
		// there is indented code.
		let minIndent: number | undefined;
		for (const selection of selections) {
			for (let lineNumber = selection.start.line; lineNumber <= selection.end.line; lineNumber++) {
				const line = document.lineAt(lineNumber);
				if (line.isEmptyOrWhitespace)
					continue;

				if (!minIndent || line.firstNonWhitespaceCharacterIndex < minIndent)
					minIndent = line.firstNonWhitespaceCharacterIndex;
			}
		}

		await editor.edit((edit) => {
			for (const selection of selections) {
				for (let lineNumber = selection.start.line; lineNumber <= selection.end.line; lineNumber++) {
					if (doneLines.has(lineNumber))
						continue;
					doneLines.add(lineNumber);

					const line = document.lineAt(lineNumber);
					if (line.isEmptyOrWhitespace)
						continue;

					const insertionPoint = line.range.start.translate(0, minIndent);
					edit.insert(insertionPoint, prefix);
				}
			}
		});
	}

	private async removeLinePrefixes(editor: vs.TextEditor, selections: readonly vs.Selection[], prefixes: string[]) {
		const document = editor.document;
		// In case we have overlapping selections, keep track of lines we've done.
		const doneLines = new Set<number>();

		await editor.edit((edit) => {
			for (const selection of selections) {
				for (let lineNumber = selection.start.line; lineNumber <= selection.end.line; lineNumber++) {
					if (doneLines.has(lineNumber))
						continue;
					doneLines.add(lineNumber);

					const line = document.lineAt(lineNumber);
					if (line.isEmptyOrWhitespace)
						continue;

					const lineContentStart = line.range.start.translate(0, line.firstNonWhitespaceCharacterIndex);
					for (const prefix of prefixes) {
						const possiblePrefixRange = new vs.Range(lineContentStart, lineContentStart.translate(0, prefix.length));
						const possiblePrefix = document.getText(possiblePrefixRange);
						if (possiblePrefix === prefix) {
							edit.delete(possiblePrefixRange);
							break;
						}
					}
				}
			}
		});
	}

	private async addCommentsToCode() {
		const editor = getActiveRealFileEditor();
		if (!editor) {
			return;
		}

		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);

		if (!selectedText.trim()) {
			void vs.window.showInformationMessage("Please select some code to add comments to.");
			return;
		}

		try {
			await vs.window.withProgress({
				location: vs.ProgressLocation.Notification,
				title: "Adding comments to code...",
				cancellable: false
			}, async () => {
				// We could provide a filter here, but for this test just get them all.
				const models = await vs.lm.selectChatModels();
				if (!models || models.length === 0) {
					void vs.window.showErrorMessage("No language models available.");
					return;
				}

				// And just use the first one.
				// We could use extesionContext.languageModelAccessInformation.canSendRequest() to tell if we already have permission before trying to use a model.
				const model = models[0];
				const messages = [
					vs.LanguageModelChatMessage.User(`
						Please add helpful comments to explain the following code.
						Keep the code structure intact, just add comments.
						Do not wrap the code in any markers, only return the raw code.
						Here's the code:

						${selectedText}
					`)
				];

				const response = await model.sendRequest(messages, {}, new vs.CancellationTokenSource().token);
				let commentedCode = "";
				for await (const fragment of response.stream) {
					if (fragment instanceof vs.LanguageModelTextPart) {
						commentedCode += fragment.value;
					}
				}

				// Replace the selection with the commented code
				await editor.edit((editBuilder) => {
					editBuilder.replace(selection, commentedCode);
				});
			});
		} catch (error) {
			void vs.window.showErrorMessage(`Failed to add comments: ${error}`);
		}
	}

	public dispose(): any {
		for (const command of this.commands)
			command.dispose();
	}
}
