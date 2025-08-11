import * as path from "path";
import * as vs from "vscode";
import { dartVMPath, flutterPath } from "../shared/constants";
import { DartWorkspaceContext, IAmDisposable, Logger } from "../shared/interfaces";
import { disposeAll } from "../shared/utils";
import { fsPath } from "../shared/utils/fs";
import { openLogContents } from "./utils";
import { getLogHeader } from "./utils/log";
import { runToolProcess } from "./utils/processes";

export class DiagnosticReport implements IAmDisposable {
	protected readonly disposables: vs.Disposable[] = [];

	private readonly output: string[] = [];

	private readonly emptyReporter = (_message: string | undefined) => { };
	private report = this.emptyReporter;

	constructor(private readonly logger: Logger, private readonly workspaceContext: DartWorkspaceContext, private readonly rebuildLogHeaders: () => void) {
		this.disposables.push(vs.commands.registerCommand("dart.generateDiagnosticReport", () => this.generateDiagnosticReportWithProgress()));
	}

	private async generateDiagnosticReportWithProgress() {
		this.output.length = 0;
		return vs.window.withProgress(
			{
				cancellable: true,
				location: vs.ProgressLocation.Notification,
				title: "Collecting Diagnostic Information",
			},
			async (progress, token) => {
				this.report = (message: string | undefined) => progress.report({ message });
				await this.generateDiagnosticReport(progress, token);
				this.report = this.emptyReporter;
			}
		);
	}

	private append(message: string) {
		this.output.push(message.trimEnd());
	}

	private async generateDiagnosticReport(progress: vs.Progress<{ message?: string; increment?: number }>, token: vs.CancellationToken) {
		this.rebuildLogHeaders();
		this.append("**!! ⚠️ PLEASE REVIEW THIS REPORT FOR SENSITIVE INFORMATION BEFORE SHARING ⚠️ !!**");
		try {
			this.append("<details>");
			this.append("<summary><strong>Workspace Environment</strong></summary>");
			this.append(`\`\`\`text\n${getLogHeader(true)}\n\`\`\``);
			this.append("</details>");

			if (token.isCancellationRequested) return;

			// TODO(dantup): Add summary of SDK search?

			await this.appendDartCommandOutput("dart info", ["info"]);
			if (token.isCancellationRequested) return;

			if (this.workspaceContext.hasAnyFlutterProjects) {
				await this.appendFlutterCommandOutput("flutter doctor", ["doctor", "-v"]);
			}
		} catch (e) {
			this.append(`Failed to generate log: ${e}`);
		}

		if (token.isCancellationRequested) return;

		await openLogContents("md", this.output.join("\n\n"));
	}

	private async appendDartCommandOutput(name: string, args: string[]): Promise<void> {
		const dartExecutable = path.join(this.workspaceContext.sdks.dart, dartVMPath);
		await this.appendCommandOutput(name, dartExecutable, args);
	}

	private async appendFlutterCommandOutput(name: string, args: string[]): Promise<void> {
		const flutterSdkPath = this.workspaceContext.sdks.flutter;
		if (!flutterSdkPath) return;

		const flutterExecutable = path.join(flutterSdkPath, flutterPath);
		await this.appendCommandOutput(name, flutterExecutable, args, { prefix: "```text\n", suffix: "\n```" });
	}

	private async appendCommandOutput(name: string, executable: string, args: string[], { prefix, suffix }: { prefix?: string, suffix?: string } = {}): Promise<void> {
		prefix ??= "";
		suffix ??= "";
		const workspaceUri = vs.workspace.workspaceFolders?.find((wf) => wf.uri.scheme === "file")?.uri;
		const workingDirectory = workspaceUri ? fsPath(workspaceUri) : undefined;

		this.report(`${name}…`);
		this.append("<details>");
		this.append(`<summary><strong>Output from '${name}'</strong></summary>`);
		this.append(`\`${executable} ${args.join(" ")}\``);
		const results = await runToolProcess(this.logger, workingDirectory, executable, args);
		if (!results.exitCode) {
			this.append(`${prefix}${results.stdout.trim()}${suffix}`);
		} else {
			this.append(`
**Failed to run ${name} (exit code ${results.exitCode}):**

#### STDOUT
\`\`\`text
${results.stdout.trim()}
\`\`\`

#### STDERR
\`\`\`text
${results.stderr.trim()}
\`\`\`
			`.trim());
		}
		this.append("</details>");
		this.report(undefined);
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
