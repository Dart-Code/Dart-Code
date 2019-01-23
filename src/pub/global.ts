import * as path from "path";
import * as vs from "vscode";
import { pubGlobalDocsUrl } from "../constants";
import { safeSpawn } from "../debug/utils";
import { pubPath } from "../sdk/utils";
import { openInBrowser, Sdks } from "../utils";

export class PubGlobal {
	constructor(private sdks: Sdks) { }

	public async promptToInstallIfRequired(packageName: string, packageID: string, moreInfoLink = pubGlobalDocsUrl): Promise<boolean> {
		const isAvailable = await this.isAvailable(packageName, packageID);
		if (isAvailable)
			return true;

		if (!isAvailable) {
			const moreInfo = "More Info";
			const activateForMe = `Activate ${packageName}`;
			let action = await vs.window.showErrorMessage(`${packageName} has not been activated. Please run 'pub global activate ${packageID}'.`, activateForMe, moreInfo);

			if (action === moreInfo) {
				openInBrowser(moreInfoLink);
				return false;
			} else if (action === activateForMe) {
				const output = await this.runCommandWithProgress(packageName, `Activating ${packageName}...`, ["global", "activate", packageID]);
				if (await this.isAvailable(packageName, packageID)) {
					return true;
				} else {
					action = await vs.window.showErrorMessage(`Failed to install ${packageName}. Please try installing manually.`, moreInfo);
					if (action === moreInfo) {
						openInBrowser(moreInfoLink);
					}
					return false;
				}
			}

			return false;
		}
	}

	public async isAvailable(packageName: string, packageID: string): Promise<boolean> {
		const output = await this.runCommand(packageName, ["global", "list"]);
		return output.indexOf(`${packageID} `) !== -1;
	}

	private runCommandWithProgress(packageName: string, title: string, args: string[]): Thenable<string> {
		return vs.window.withProgress({
			location: vs.ProgressLocation.Notification,
			title,
		}, (_) => this.runCommand(packageName, args));
	}

	private runCommand(packageName: string, args: string[]): Thenable<string> {
		return new Promise((resolve, reject) => {
			const pubBinPath = path.join(this.sdks.dart, pubPath);
			const proc = safeSpawn(undefined, pubBinPath, args);
			const stdout: string[] = [];
			const stderr: string[] = [];
			proc.stdout.on("data", (data) => stdout.push(data.toString()));
			proc.stderr.on("data", (data) => stderr.push(data.toString()));
			proc.on("close", (code) => {
				if (code === 0) {
					resolve(stdout.join(""));
				} else {
					reject(`${packageName} exited with code ${code}.\n\n${stdout.join("")}\n\n${stderr.join("")}`);
				}
			});
		});
	}
}
