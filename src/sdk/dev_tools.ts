import * as child_process from "child_process";
import * as path from "path";
import * as vs from "vscode";
import { Analytics } from "../analytics";
import { config } from "../config";
import { CHROME_OS_DEVTOOLS_PORT } from "../constants";
import { isChromeOS, LogCategory, LogSeverity } from "../debug/utils";
import { PubGlobal } from "../pub/global";
import { openInBrowser, Sdks } from "../utils";
import { log, logError, logProcess } from "../utils/log";
import { safeSpawn } from "../utils/processes";
import { DartDebugSessionInformation } from "../utils/vscode/debug";
import { pubPath } from "./utils";

const devtools = "devtools";
const devtoolsPackageName = "Dart DevTools";

// This starts off undefined, which means we'll read from config.devToolsPort and all back to 0 (auto-assign).
// Once we get a port we'll update this variable so that if we restart (eg. a silent extension restart due to
// SDK change or similar) we will try to use the same port, so if the user has browser windows open they're
// still valid.
let portToBind: number | undefined;

export class DevTools implements vs.Disposable {
	private devToolsStatusBarItem = vs.window.createStatusBarItem(vs.StatusBarAlignment.Right, 100);
	private proc: child_process.ChildProcess | undefined;
	private realPid: number | undefined;
	/// Resolves to the DevTools URL. This is created immediately when a new process is being spawned so that
	/// concurrent launches can wait on the same promise.
	private devtoolsUrl: Thenable<string> | undefined;

	constructor(private sdks: Sdks, private analytics: Analytics, private pubGlobal: PubGlobal) { }

	/// Spawns DevTools and returns the full URL to open for that session
	///   eg. http://localhost:8123/?port=8543
	public async spawnForSession(session: DartDebugSessionInformation): Promise<{ url: string, dispose: () => void } | undefined> {
		this.analytics.logDebuggerOpenDevTools();

		const isAvailable = await this.pubGlobal.promptToInstallIfRequired(devtoolsPackageName, devtools, undefined, "0.0.16", true);
		if (!isAvailable) {
			return undefined;
		}

		if (!this.devtoolsUrl) {
			this.devtoolsUrl = vs.window.withProgress({
				location: vs.ProgressLocation.Notification,
				title: "Starting Dart DevTools...",
			}, async (_) => this.spawnDevTools());
		}
		try {
			const url = await this.devtoolsUrl;
			const fullUrl = `${url}?hide=debugger&uri=${encodeURIComponent(session.vmServiceUri)}${config.useDevToolsDarkTheme ? "&theme=dark" : ""}`;
			this.devToolsStatusBarItem.text = "Dart DevTools";
			this.devToolsStatusBarItem.tooltip = `Dart DevTools is running at ${url}`;
			this.devToolsStatusBarItem.command = "dart.openDevTools";
			this.devToolsStatusBarItem.show();
			openInBrowser(fullUrl);
			return { url: fullUrl, dispose: () => this.dispose() };
		} catch (e) {
			this.devToolsStatusBarItem.hide();
			vs.window.showErrorMessage(`${e}`);
		}
	}

	/// Starts the devtools server and returns the URL of the running app.
	private spawnDevTools(): Promise<string> {
		return new Promise((resolve, reject) => {
			const pubBinPath = path.join(this.sdks.dart, pubPath);
			portToBind = config.devToolsPort // Always config first
				|| portToBind                // Then try the last port we bound this session
				|| (isChromeOS && config.useKnownChromeOSPorts ? CHROME_OS_DEVTOOLS_PORT : 0);
			const args = ["global", "run", "devtools", "--machine", "--port", portToBind.toString()];

			const proc = safeSpawn(undefined, pubBinPath, args);
			this.proc = proc;

			log(`(PROC ${proc.pid}) Spawned ${pubBinPath} ${args.join(" ")}`, LogSeverity.Info, LogCategory.CommandProcesses);
			logProcess(LogCategory.CommandProcesses, proc);

			const stdout: string[] = [];
			const stderr: string[] = [];
			this.proc.stdout.on("data", (data) => {
				const output = data.toString();
				stdout.push(output);
				try {
					const evt = JSON.parse(output);
					if (evt.method === "server.started") {
						portToBind = evt.params.port;
						this.realPid = evt.params.pid;
						resolve(`http://${evt.params.host}:${evt.params.port}/`);
					}
				} catch {
					console.warn(`Non-JSON output from DevTools: ${output}`);
				}
			});
			this.proc.stderr.on("data", (data) => stderr.push(data.toString()));
			this.proc.on("close", (code) => {
				this.proc = undefined;
				this.devtoolsUrl = undefined;
				this.devToolsStatusBarItem.hide();
				if (code && code !== 0) {
					// Reset the port to 0 on error in case it was from us trying to reuse the previous port.
					portToBind = 0;
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
		this.devtoolsUrl = undefined;
		if (this.proc && !this.proc.killed) {
			this.proc.kill();
		}
		if (this.realPid) {
			try {
				process.kill(this.realPid);
			} catch (e) {
				// Sometimes this process will have already gone away (eg. the initial kill() worked)
				// so logging here just results in lots of useless info.
			}
			this.realPid = undefined;
		}
	}
}
