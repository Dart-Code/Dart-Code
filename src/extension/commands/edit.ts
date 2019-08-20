import * as vs from "vscode";
import { showCode } from "../utils/vscode/editor";

export class EditCommands implements vs.Disposable {
	private commands: vs.Disposable[] = [];

	constructor() {
		this.commands.push(
			vs.commands.registerCommand("_dart.jumpToLineColInUri", this.jumpToLineColInUri, this),
			vs.commands.registerCommand("_dart.showCode", showCode, this),
		);
	}

	private async jumpToLineColInUri(uri: vs.Uri, lineNumber?: number, columnNumber?: number) {
		if (!uri || uri.scheme !== "file")
			return;

		const doc = await vs.workspace.openTextDocument(uri);
		const editor = await vs.window.showTextDocument(doc);
		if (lineNumber && columnNumber) {
			const line = doc.lineAt(lineNumber > 0 ? lineNumber - 1 : 0);
			const firstChar = line.range.start.translate({ characterDelta: line.firstNonWhitespaceCharacterIndex });
			showCode(editor, line.range, line.range, new vs.Range(firstChar, firstChar));
		}
	}

	public dispose(): any {
		for (const command of this.commands)
			command.dispose();
	}
}
