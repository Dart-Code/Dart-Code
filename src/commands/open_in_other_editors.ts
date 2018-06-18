import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { safeSpawn } from "../debug/utils";
import { fsPath } from "../utils";

export class OpenInOtherEditorCommands implements vs.Disposable {
	private disposables: vs.Disposable[] = [];

	constructor() {

		this.disposables.push(
			vs.commands.registerCommand("flutter.openInXcode", this.openInXcode, this),
		);
	}

	private async openInXcode(resource: vs.Uri): Promise<void> {
		const folder = fsPath(resource);
		const files = fs
			.readdirSync(folder)
			.filter((item) => fs.statSync(path.join(folder, item)).isDirectory())
			.filter((item) => item.endsWith(".xcworkspace") || item.endsWith(".xcodeproj"))
			.sort((f1, f2) => f1.endsWith(".xcworkspace") ? 0 : 1);

		if (files && files.length) {
			const file = path.join(folder, files[0]);
			safeSpawn(folder, "open", [file]);
		} else {
			vs.window.showErrorMessage(`Unable to find an Xcode project in your 'ios' folder`);
		}
	}

	public dispose(): any {
		for (const command of this.disposables)
			command.dispose();
	}
}
