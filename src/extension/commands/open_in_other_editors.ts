import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { androidStudioPaths, isMac } from "../../shared/constants";
import { Logger, Sdks } from "../../shared/interfaces";
import { fsPath } from "../../shared/utils/fs";
import { getFlutterConfigValue } from "../utils/misc";
import { safeToolSpawn } from "../utils/processes";

export class OpenInOtherEditorCommands implements vs.Disposable {
	private disposables: vs.Disposable[] = [];

	constructor(private readonly logger: Logger, private readonly sdks: Sdks) {

		this.disposables.push(
			vs.commands.registerCommand("flutter.openInAndroidStudio", this.openInAndroidStudio, this),
			vs.commands.registerCommand("flutter.openInXcode", this.openInXcode, this),
		);
	}

	private async openInAndroidStudio(resource: vs.Uri): Promise<void> {
		const folder = fsPath(resource);

		let androidStudioDir = await this.getAndroidStudioDir(folder);

		if (!androidStudioDir) {
			void vs.window.showErrorMessage("Unable to find Android Studio");
			return;
		}

		if (isMac && androidStudioDir.endsWith("/Contents")) {
			androidStudioDir = androidStudioDir.substr(0, androidStudioDir.length - "/Contents".length);
			safeToolSpawn(folder, "open", ["-a", androidStudioDir, folder]);
			return;
		} else {
			for (const androidStudioPath of androidStudioPaths) {
				const fullPath = path.join(androidStudioDir, androidStudioPath);
				if (fs.existsSync(fullPath)) {
					safeToolSpawn(folder, fullPath, [folder]);
					return;
				}
			}
		}
		void vs.window.showErrorMessage("Unable to locate Android Studio executable");
	}

	private async openInXcode(resource: vs.Uri): Promise<void> {
		const folder = fsPath(resource);
		const files = fs
			.readdirSync(folder, { withFileTypes: true })
			.filter((item) => item.isDirectory())
			.filter((item) => item.name.endsWith(".xcworkspace") || item.name.endsWith(".xcodeproj"))
			.sort((f1, f2) => f1.name.endsWith(".xcworkspace") ? -1 : 1);

		if (!files?.length) {
			const basename = path.basename(folder);
			void vs.window.showErrorMessage(`Unable to find an Xcode project in your '${basename}' folder`);
			return;
		}

		const file = path.join(folder, files[0].name);
		safeToolSpawn(folder, "open", ["-a", "XCode", file]);
	}

	private async getAndroidStudioDir(folder: string): Promise<string> {
		return getFlutterConfigValue(this.logger, this.sdks.flutter, folder, "android-studio-dir");
	}

	public dispose(): any {
		for (const command of this.disposables)
			command.dispose();
	}
}
