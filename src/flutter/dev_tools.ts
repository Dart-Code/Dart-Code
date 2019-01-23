import * as child_process from "child_process";
import * as path from "path";
import * as vs from "vscode";
import { config } from "../config";
import { LogCategory, LogSeverity, safeSpawn } from "../debug/utils";
import { PubGlobal } from "../pub/global";
import { pubPath } from "../sdk/utils";
import { openInBrowser, Sdks } from "../utils";
import { DartDebugSessionInformation, extractObservatoryPort } from "../utils/debug";
import { log, logError } from "../utils/log";
import { logProcess } from "../utils/processes";

const webdevPackageID = "webdev";
const webdevPackageName = webdevPackageID;

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// TODO: HACK: THIS NEEDS REMOVING :)
// https://github.com/flutter/devtools/issues/153
const dartSdkPath = "/Users/dantup/Dev/dart-sdk/v2.1/";

// Serving `web` on http://localhost:8080
const webdevServingRegex = /Serving.*? on http:\/\/localhost:([0-9]+)\/?$/m;

export class FlutterDevTools implements vs.Disposable {
	private proc: child_process.ChildProcess;

	constructor(private sdks: Sdks, private pubGlobal: PubGlobal, private session: DartDebugSessionInformation) {
		this.spawnForSession();
	}

	private async spawnForSession(): Promise<void> {
		const isAvailable = await this.pubGlobal.promptToInstallIfRequired(webdevPackageName, webdevPackageID);
		if (!isAvailable) {
			return;
		}

		const observatoryPort = extractObservatoryPort(this.session.observatoryUri);
		await vs.window.withProgress({
			location: vs.ProgressLocation.Notification,
			title: "Starting Flutter Dev Tools...",
		}, async (_) => {
			const toolsPort = await this.webdevServe();
			openInBrowser(`http://localhost:${toolsPort}/?port=${observatoryPort}`);
		});
	}

	/// Starts the webdev server and returns the port of the running app.
	private webdevServe(): Promise<number> {
		return new Promise((resolve, reject) => {
			const toolsPath = config.previewFlutterDevToolsRepositoryPath;
			const pubBinPath = path.join(/*this.sdks.dart*/dartSdkPath, pubPath);
			const args = ["global", "run", "webdev", "serve", "web"];

			const proc = safeSpawn(toolsPath, pubBinPath, args);
			this.proc = proc;

			const logPrefix = `(PROC ${proc.pid})`;
			log(`${logPrefix} Spawned ${pubBinPath} ${args.join(" ")} in ${toolsPath}`, LogSeverity.Info, LogCategory.CommandProcesses);
			logProcess(LogCategory.CommandProcesses, logPrefix, proc);

			const stdout: string[] = [];
			const stderr: string[] = [];
			this.proc.stdout.on("data", (data) => {
				const output = data.toString();
				stdout.push(output);
				const matches = webdevServingRegex.exec(output);
				if (matches) {
					resolve(parseInt(matches[1], 10));
				}
			});
			this.proc.stderr.on("data", (data) => stderr.push(data.toString()));
			this.proc.on("close", (code) => {
				if (code && code !== 0) {
					const errorMessage = `${webdevPackageName} exited with code ${code}.\n\n${stdout.join("")}\n\n${stderr.join("")}`;
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
