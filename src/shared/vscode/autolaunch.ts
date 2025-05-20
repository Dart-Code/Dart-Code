import * as fs from "fs";
import { debug, DebugConfiguration, Uri, workspace, WorkspaceFolder } from "vscode";
import { IAmDisposable, Logger } from "../interfaces";
import { disposeAll } from "../utils";
import { fsPath } from "../utils/fs";
import { FlutterDeviceManager } from "./device_manager";

export class AutoLaunch implements IAmDisposable {
	private readonly disposables: IAmDisposable[] = [];

	constructor(private readonly logger: Logger, private readonly deviceManager: FlutterDeviceManager | undefined) {
		const watcher = workspace.createFileSystemWatcher("**/.dart_code/autolaunch.json", false, true, true);
		watcher.onDidCreate((uri) => {
			// If there are any existing debug sessions, don't spawn more because we don't know they don't overlap.
			if (debug.activeDebugSession)
				return;
			this.handleChange(uri);
		});
		this.disposables.push(watcher);

		// If there are any existing debug sessions, don't spawn more because we don't know they don't overlap.
		if (debug.activeDebugSession)
			return;
		if (workspace.workspaceFolders) {
			for (const wf of workspace.workspaceFolders) {
				this.handleChange(Uri.joinPath(wf.uri, ".dart_code", "autolaunch.json"));
			}
		}
	}

	private handleChange(uri: Uri): void {
		if (uri.scheme !== "file")
			return;

		try {
			const wf = workspace.getWorkspaceFolder(uri);
			const filePath = fsPath(uri);
			const fileContents = fs.readFileSync(filePath, "utf8");
			const jsonData = JSON.parse(fileContents);
			const configurations = jsonData?.configurations;
			if (Array.isArray(configurations)) {
				for (const configuration of configurations) {
					const name = configuration.name;
					const type = configuration.type;
					const request = configuration.request;
					if (!name) {
						this.logger.warn(`Ignoring configuration without name in autolaunch file ${uri}`);
						continue;
					}
					if (type !== "dart") {
						this.logger.warn(`Ignoring non-dart configuration in autolaunch file ${uri}`);
						continue;
					}
					if (request !== "launch" && request !== "attach") {
						this.logger.warn(`Ignoring configuration with invalid request (${request}) in autolaunch file ${uri}`);
						continue;
					}

					void this.startDebugSession(wf, configuration as DebugConfiguration);
				}
			}

		} catch (e: any) {
			if (e.code === "ENOENT") {
				// File not found, silently ignore
				return;
			}
			this.logger.warn(`Failed to process autolaunch file ${uri}: ${e}`);
		}
	}

	private async startDebugSession(wf: WorkspaceFolder | undefined, configuration: DebugConfiguration): Promise<void> {
		// If this configuration targets a device, allow time for it to appear because starting the
		// daemon and getting device events may take a little time.
		const deviceId = configuration.deviceId as string | undefined;
		if (this.deviceManager && deviceId) {
			for (let seconds = 0; seconds < 30; seconds++) {
				if (this.deviceManager.getDevice(deviceId))
					break;
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
			if (!this.deviceManager.getDevice(deviceId)) {
				this.logger.warn(`Failed to autolaunch because device ${deviceId} was not found`);
				return;
			}
		}

		void debug.startDebugging(wf, configuration);
	}

	public dispose(): void | Promise<void> {
		disposeAll(this.disposables);
	}
}
