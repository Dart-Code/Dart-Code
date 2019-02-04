import * as child_process from "child_process";
import * as path from "path";
import * as vs from "vscode";
import { Analytics } from "../analytics";
import { LogCategory, LogSeverity, safeSpawn } from "../debug/utils";
import { PubGlobal } from "../pub/global";
import { pubPath } from "../sdk/utils";
import { openInBrowser, Sdks } from "../utils";
import { DartDebugSessionInformation, extractObservatoryPort } from "../utils/debug";
import { log, logError } from "../utils/log";
import { logProcess } from "../utils/processes";

// TODO: Update this before shipping!
const tempActivationGitUrl = "https://github.com/DanTup/devtools-test/";
// TODO: Implement a min version check that can prompt to re-activate.
const devtools = "devtools";
const devtoolsPackageName = "Dart DevTools";

// TODO: We should just create one instance of this class, and reuse it when the command is run (so the port can
// stay stable).
export class FlutterDevTools implements vs.Disposable {
	private devToolsStatusBarItem = vs.window.createStatusBarItem(vs.StatusBarAlignment.Right, 100);
	private proc: child_process.ChildProcess;
	/// Resolves to the DevTools URL. This is created immediately when a new process is being spawned so that
	/// concurrent launches can wait on the same promise.
	private devtoolsUrl: Thenable<string>;

	constructor(private sdks: Sdks, private analytics: Analytics, private pubGlobal: PubGlobal) { }

	public async spawnForSession(session: DartDebugSessionInformation): Promise<void> {
		this.analytics.logDebuggerOpenDevTools();

		const isAvailable = await this.pubGlobal.promptToInstallIfRequired(devtoolsPackageName, devtools, undefined, "0.0.1", tempActivationGitUrl);
		if (!isAvailable) {
			return;
		}

		const observatoryPort = extractObservatoryPort(session.observatoryUri);

		if (!this.devtoolsUrl) {
			this.devtoolsUrl = vs.window.withProgress({
				location: vs.ProgressLocation.Notification,
				title: "Starting Dart DevTools...",
			}, async (_) => this.spawnDevTools());
		}
		try {
			const url = await this.devtoolsUrl;
			this.devToolsStatusBarItem.text = "Dart DevTools";
			this.devToolsStatusBarItem.tooltip = `Dart DevTools is running at ${url}`;
			this.devToolsStatusBarItem.command = "dart.openDevTools";
			this.devToolsStatusBarItem.show();
			openInBrowser(`${url}?port=${observatoryPort}`);
		} catch (e) {
			this.devToolsStatusBarItem.hide();
			vs.window.showErrorMessage(`${e}`);
		}
	}

	/// Starts the devtools server and returns the URL of the running app.
	private spawnDevTools(): Promise<string> {
		return new Promise((resolve, reject) => {
			const pubBinPath = path.join(this.sdks.dart, pubPath);
			const args = ["global", "run", "devtools", "--machine", "--port", "0"];

			const proc = safeSpawn(undefined, pubBinPath, args);
			this.proc = proc;

			const logPrefix = `(PROC ${proc.pid})`;
			log(`${logPrefix} Spawned ${pubBinPath} ${args.join(" ")}`, LogSeverity.Info, LogCategory.CommandProcesses);
			logProcess(LogCategory.CommandProcesses, logPrefix, proc);

			const stdout: string[] = [];
			const stderr: string[] = [];
			this.proc.stdout.on("data", (data) => {
				const output = data.toString();
				stdout.push(output);
				try {
					const evt = JSON.parse(output);
					if (evt.method === "server.started") {
						resolve(`http://${evt.params.host}:${evt.params.port}/`);
					}
				} catch {
					console.warn(`Non-JSON output from DevTools: ${output}`);
				}
			});
			this.proc.stderr.on("data", (data) => stderr.push(data.toString()));
			this.proc.on("close", (code) => {
				this.proc = null;
				this.devtoolsUrl = null;
				this.devToolsStatusBarItem.hide();
				if (code && code !== 0) {
					const errorMessage = `${devtoolsPackageName} exited with code ${code}: ${stdout.join("")} ${stderr.join("")}`;
					logError(errorMessage);
					reject(errorMessage);
				} else {
					// We must always compelete the promise in case we didn't match the regex above, else the
					// notification will hang around forever.
					resolve();
				}
			});
		});
	}

	public dispose(): void {
		this.devToolsStatusBarItem.dispose();
		if (this.proc && !this.proc.killed) {
			this.proc.kill();
		}
	}
}
