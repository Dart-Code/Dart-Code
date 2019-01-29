import * as child_process from "child_process";
import * as path from "path";
import * as vs from "vscode";
import { LogCategory, LogSeverity, safeSpawn } from "../debug/utils";
import { PubGlobal } from "../pub/global";
import { pubPath } from "../sdk/utils";
import { openInBrowser, Sdks } from "../utils";
import { DartDebugSessionInformation, extractObservatoryPort } from "../utils/debug";
import { log, logError } from "../utils/log";
import { logProcess } from "../utils/processes";

// TODO: Update this before shipping!
const tempActivationGitUrl = "https://github.com/DanTup/devtools/";
const devtools = "devtools";
const devtoolsPackageName = "Dart DevTools";

// TODO: We should just create one instance of this class, and reuse it when the command is run (so the port can
// stay stable).
export class FlutterDevTools implements vs.Disposable {
	private proc: child_process.ChildProcess;

	constructor(private sdks: Sdks, private pubGlobal: PubGlobal, private session: DartDebugSessionInformation) {
		this.spawnForSession();
	}

	private async spawnForSession(): Promise<void> {
		const isAvailable = await this.pubGlobal.promptToInstallIfRequired(devtoolsPackageName, devtools, undefined, tempActivationGitUrl);
		if (!isAvailable) {
			return;
		}

		const observatoryPort = extractObservatoryPort(this.session.observatoryUri);
		await vs.window.withProgress({
			location: vs.ProgressLocation.Notification,
			title: "Starting Dart DevTools...",
		}, async (_) => {
			const devtoolsUrl = await this.spawnDevTools();
			openInBrowser(`${devtoolsUrl}?port=${observatoryPort}`);
		});
	}

	/// Starts the devtools server and returns the URL of the running app.
	private spawnDevTools(): Promise<string> {
		return new Promise((resolve, reject) => {
			const pubBinPath = path.join(this.sdks.dart, pubPath);
			const args = ["global", "run", "devtools", "--machine"];

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
				if (code && code !== 0) {
					const errorMessage = `${devtoolsPackageName} exited with code ${code}.\n\n${stdout.join("")}\n\n${stderr.join("")}`;
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
		if (this.proc && !this.proc.killed) {
			this.proc.kill();
		}
	}
}
