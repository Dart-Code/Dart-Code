import * as path from "path";
import * as vs from "vscode";
import { stagehandInstallationInstructionsUrl } from "../../shared/constants";
import { LogCategory } from "../debug/utils";
import { pubPath } from "../sdk/utils";
import { Sdks } from "../utils";
import { logProcess } from "../utils/log";
import { safeSpawn } from "../utils/processes";
import { PubGlobal } from "./global";

const packageName = "Stagehand";
const packageID = "stagehand";

export class Stagehand {
	constructor(private sdks: Sdks, private pubGlobal: PubGlobal) { }

	public promptToInstallIfRequired() {
		return this.pubGlobal.promptToInstallIfRequired(packageName, packageID, stagehandInstallationInstructionsUrl, "3.3.0");
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
			logProcess(LogCategory.CommandProcesses, proc);

			const stdout: string[] = [];
			const stderr: string[] = [];
			proc.stdout.on("data", (data) => stdout.push(data.toString()));
			proc.stderr.on("data", (data) => stderr.push(data.toString()));
			proc.on("close", (code) => {
				if (!code) {
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
	readonly categories: string[];
	readonly entrypoint: string;
}
