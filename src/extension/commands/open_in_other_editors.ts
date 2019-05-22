import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { androidStudioPath, flutterPath, isMac } from "../../shared/constants";
import { Sdks } from "../../shared/interfaces";
import { fsPath } from "../../shared/vscode/utils";
import { logError } from "../utils/log";
import { safeSpawn } from "../utils/processes";

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

		let androidStudioDir = await this.getAndroidStudioDir(folder);

		if (!androidStudioDir) {
			vs.window.showErrorMessage(`Unable to find Android Studio`);
			return;
		}
		if (isMac && androidStudioDir.endsWith("/Contents")) {
			androidStudioDir = androidStudioDir.substr(0, androidStudioDir.length - "/Contents".length);
			safeSpawn(folder, "open", ["-a", androidStudioDir, folder]);
		} else {
			safeSpawn(folder, path.join(androidStudioDir, androidStudioPath), [folder]);
		}
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
		safeSpawn(folder, "open", ["-a", "Xcode", file]);
	}

	private getAndroidStudioDir(folder: string): Promise<string> {
		// TODO: Move this to call shared runProcess().
		return new Promise((resolve, reject) => {
			if (!this.sdks.flutter) {
				reject("Cannot find Android Studio without a Flutter SDK");
				return;
			}
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
