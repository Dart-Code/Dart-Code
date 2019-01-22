import * as path from "path";
import * as vs from "vscode";
import { stagehandInstallationInstructionsUrl } from "../constants";
import { safeSpawn } from "../debug/utils";
import { pubPath } from "../sdk/utils";
import { openInBrowser, Sdks } from "../utils";

export class Stagehand {
	constructor(private sdks: Sdks) { }

	public async promptToInstallIfRequired(): Promise<boolean> {
		const isAvailable = await this.isAvailable();
		if (isAvailable)
			return true;

		if (!isAvailable) {
			const moreInfo = "More Info";
			const activateForMe = "Activate Stagehand";
			let action = await vs.window.showErrorMessage("Stagehand has not been activated. Please run 'pub global activate stagehand'.", activateForMe, moreInfo);

			if (action === moreInfo) {
				openInBrowser(stagehandInstallationInstructionsUrl);
				return false;
			} else if (action === activateForMe) {
				const output = await this.runCommandWithProgress("Activating Stagehand...", ["global", "activate", "stagehand"]);
				if (output.indexOf("Installed executable stagehand") !== -1) {
					return true;
				} else if (await this.isAvailable()) {
					return true;
				} else {
					action = await vs.window.showErrorMessage("Failed to install Stagehand. Please try installing manually.", moreInfo);
					if (action === moreInfo) {
						openInBrowser(stagehandInstallationInstructionsUrl);
					}
					return false;
				}
			}

			return false;
		}
	}

	private async isAvailable(): Promise<boolean> {
		const output = await this.runCommand(["global", "list"]);
		return output.indexOf("stagehand") !== -1;
	}

	public async getTemplates(): Promise<StagehandTemplate[]> {
		const json = await this.getTemplateJson();
		return JSON.parse(json);
	}

	private async getTemplateJson(): Promise<string> {
		return this.runCommandWithProgress("Fetching Stagehand templates...", ["global", "run", "stagehand", "--machine"]);
	}

	private runCommandWithProgress(title: string, args: string[]): Thenable<string> {
		return vs.window.withProgress({
			location: vs.ProgressLocation.Notification,
			title,
		}, (_) => this.runCommand(args));
	}

	private runCommand(args: string[]): Thenable<string> {
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
					reject(`Stagehand exited with code ${code}.\n\n${stdout.join("")}\n\n${stderr.join("")}`);
				}
			});
		});
	}
}

export interface StagehandTemplate {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly entrypoint: string;
}
