import * as path from "path";
import * as vs from "vscode";
import { pubPath, stagehandInstallationInstructionsUrl } from "../../shared/constants";
import { LogCategory } from "../../shared/enums";
import { DartProjectTemplate, DartSdks, Logger } from "../../shared/interfaces";
import { logProcess } from "../../shared/logging";
import { cleanPubOutput } from "../../shared/pub/utils";
import { safeToolSpawn } from "../utils/processes";
import { PubGlobal } from "./global";

const packageName = "Stagehand";
const packageID = "stagehand";

export class Stagehand {
	constructor(private logger: Logger, private sdks: DartSdks, private pubGlobal: PubGlobal) { }

	public installIfRequired() {
		return this.pubGlobal.installIfRequired({ packageName, packageID, moreInfoLink: stagehandInstallationInstructionsUrl, requiredVersion: "3.3.0" });
	}

	public async getTemplates(): Promise<DartProjectTemplate[]> {
		const json = await this.getTemplateJson();
		return JSON.parse(json);
	}

	private async getTemplateJson(): Promise<string> {
		return cleanPubOutput(await this.runCommandWithProgress("Fetching Stagehand templates...", ["global", "run", "stagehand", "--machine"]));
	}

	private runCommandWithProgress(title: string, args: string[]): Thenable<string> {
		return vs.window.withProgress({
			location: vs.ProgressLocation.Notification,
			title,
		}, () => this.runCommand(args));
	}

	private runCommand(args: string[]): Thenable<string> {
		const dartSdkPath = this.sdks.dart;
		const pubBinPath = path.join(dartSdkPath, pubPath);

		return new Promise((resolve, reject) => {
			const proc = safeToolSpawn(undefined, pubBinPath, args);
			logProcess(this.logger, LogCategory.CommandProcesses, proc);

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
