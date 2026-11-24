import * as path from "path";
import * as vs from "vscode";
import { dartVMPath } from "../../../shared/constants";
import { DartProjectTemplate, DartSdks, Logger } from "../../../shared/interfaces";
import { cleanPubOutput } from "../../../shared/pub/utils";
import { runToolProcess } from "../../utils/processes";

export class DartCreate {
	constructor(private logger: Logger, private sdks: DartSdks) { }

	public async getTemplates(): Promise<DartProjectTemplate[]> {
		const json = await this.getTemplateJson();
		return JSON.parse(json) as DartProjectTemplate[];
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

	private async runCommand(args: string[]): Promise<string> {
		const dartBinPath = path.join(this.sdks.dart, dartVMPath);
		const result = await runToolProcess(this.logger, undefined, dartBinPath, args);
		if (result.exitCode === 0)
			return result.stdout;
		throw new Error(`'dart create' exited with code ${result.exitCode}.\n\n${result.stdout}\n\n${result.stderr}`);
	}
}
