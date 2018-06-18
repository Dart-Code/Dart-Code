import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { isMac, safeSpawn } from "../debug/utils";
import { flutterPath } from "../sdk/utils";
import { Sdks, fsPath } from "../utils";
import { logError } from "../utils/log";

export class OpenInOtherEditorCommands implements vs.Disposable {
	private disposables: vs.Disposable[] = [];

	constructor(private readonly sdks: Sdks) {

		this.disposables.push(
			vs.commands.registerCommand("flutter.openInAndroidStudio", this.openInAndroidStudio, this),
			vs.commands.registerCommand("flutter.openInXcode", this.openInXcode, this),
		);
	}

	private async openInAndroidStudio(resource: vs.Uri): Promise<void> {
		const folder = fsPath(resource);
		const parentFolder = path.dirname(folder);
		const files = fs
			.readdirSync(parentFolder)
			.filter((item) => fs.statSync(path.join(parentFolder, item)).isFile())
			.filter((item) => item.endsWith("_android.iml"));

		if (!files || !files.length) {
			vs.window.showErrorMessage(`Unable to find an Android .iml file in your project`);
			return;
		}

		let androidStudioDir = await this.getAndroidStudioDir(parentFolder);

		if (!androidStudioDir) {
			vs.window.showErrorMessage(`Unable to find Android Studio`);
			return;
		}
		if (isMac && androidStudioDir.endsWith("/Contents"))
			androidStudioDir = androidStudioDir.substr(0, androidStudioDir.length - "/Contents".length);

		const file = path.join(parentFolder, files[0]);
		if (isMac)
			safeSpawn(folder, "open", ["-a", androidStudioDir, file]);
		else
			safeSpawn(folder, androidStudioDir, [file]);
	}

	private async openInXcode(resource: vs.Uri): Promise<void> {
		const folder = fsPath(resource);
		const files = fs
			.readdirSync(folder)
			.filter((item) => fs.statSync(path.join(folder, item)).isDirectory())
			.filter((item) => item.endsWith(".xcworkspace") || item.endsWith(".xcodeproj"))
			.sort((f1, f2) => f1.endsWith(".xcworkspace") ? 0 : 1);

		if (!files || !files.length) {
			vs.window.showErrorMessage(`Unable to find an Xcode project in your 'ios' folder`);
			return;
		}

		const file = path.join(folder, files[0]);
		safeSpawn(folder, "open", [file]);
	}

	private getAndroidStudioDir(folder: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const binPath = path.join(this.sdks.flutter, flutterPath);
			const proc = safeSpawn(folder, binPath, ["config", "--machine"]);
			const output: string[] = [];
			proc.stdout.on("data", (data: Buffer) => {
				output.push(data.toString());
			});
			proc.on("exit", () => {
				try {
					if (output.length) {
						const json = JSON.parse(output.join(""));
						resolve(json["android-studio-dir"] as string);
						return;
					}
				} catch (e) {
					logError(e);
				}
				reject();
			});
		});
	}

	public dispose(): any {
		for (const command of this.disposables)
			command.dispose();
	}
}
