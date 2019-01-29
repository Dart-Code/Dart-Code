import * as path from "path";
import * as vs from "vscode";
import { pubGlobalDocsUrl } from "../constants";
import { safeSpawn } from "../debug/utils";
import { pubPath } from "../sdk/utils";
import { openInBrowser, Sdks } from "../utils";

export class PubGlobal {
	constructor(private sdks: Sdks) { }

	public async promptToInstallIfRequired(packageName: string, packageID: string, moreInfoLink = pubGlobalDocsUrl, tempActivateGitSource?: string): Promise<boolean> {
		const isAvailable = await this.isAvailable(packageName, packageID);
		if (isAvailable)
			return true;

		if (!isAvailable) {
			const moreInfo = "More Info";
			const activateForMe = `Activate ${packageName}`;
			const message = `${packageName} needs to be installed with 'pub global activate ${packageID}' to use this feature.`;
			let action = await vs.window.showWarningMessage(message, activateForMe, moreInfo);

			if (action === moreInfo) {
				openInBrowser(moreInfoLink);
				return false;
			} else if (action === activateForMe) {
				const args = tempActivateGitSource
					? ["global", "activate", "--source", "git", tempActivateGitSource]
					: ["global", "activate", packageID];
				await this.runCommandWithProgress(packageName, `Activating ${packageName}...`, args);
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
				if (!code) {
					resolve(stdout.join(""));
				} else {
					reject(`${packageName} exited with code ${code}.\n\n${stdout.join("")}\n\n${stderr.join("")}`);
				}
			});
		});
	}
}
