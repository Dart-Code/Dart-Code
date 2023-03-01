import * as path from "path";
import * as vs from "vscode";
import { dartVMPath } from "../../../shared/constants";
import { LogCategory } from "../../../shared/enums";
import { DartProjectTemplate, DartSdks, Logger } from "../../../shared/interfaces";
import { logProcess } from "../../../shared/logging";
import { cleanPubOutput } from "../../../shared/pub/utils";
import { safeToolSpawn } from "../../utils/processes";

export class DartCreate {
	constructor(private logger: Logger, private sdks: DartSdks) { }

	public async getTemplates(): Promise<DartProjectTemplate[]> {
		const json = await this.getTemplateJson();
		return JSON.parse(json);
	}

	private async getTemplateJson(): Promise<string> {
		return cleanPubOutput(await this.runCommandWithProgress("Fetching project templates...", ["create", "--list-templates"]));
	}

	private runCommandWithProgress(title: string, args: string[]): Thenable<string> {
		return vs.window.withProgress({
			location: vs.ProgressLocation.Notification,
			title,
		}, () => this.runCommand(args));
	}

	private runCommand(args: string[]): Thenable<string> {
		const dartSdkPath = this.sdks.dart;
		const dartBinPath = path.join(dartSdkPath, dartVMPath);

		return new Promise((resolve, reject) => {
			const proc = safeToolSpawn(undefined, dartBinPath, args);
			logProcess(this.logger, LogCategory.CommandProcesses, proc);

			const stdout: string[] = [];
			const stderr: string[] = [];
			proc.stdout.on("data", (data: Buffer | string) => stdout.push(data.toString()));
			proc.stderr.on("data", (data: Buffer | string) => stderr.push(data.toString()));
			proc.on("close", (code) => {
				if (!code) {
					resolve(stdout.join(""));
				} else {
					reject(`'dart create' exited with code ${code}.\n\n${stdout.join("")}\n\n${stderr.join("")}`);
				}
			});
		});
	}
}
