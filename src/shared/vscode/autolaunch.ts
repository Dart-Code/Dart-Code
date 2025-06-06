import * as fs from "fs";
import * as path from "path";
import { debug, DebugConfiguration, RelativePattern, Uri, workspace, WorkspaceFolder } from "vscode";
import { autoLaunchFilename } from "../constants";
import { IAmDisposable, Logger } from "../interfaces";
import { disposeAll } from "../utils";
import { fsPath } from "../utils/fs";
import { FlutterDeviceManager } from "./device_manager";

export class AutoLaunch implements IAmDisposable {
	private readonly disposables: IAmDisposable[] = [];

	constructor(dartCodeConfigurationPath: string, readonly logger: Logger, private readonly deviceManager: FlutterDeviceManager | undefined) {

		const watcherPattern = path.isAbsolute(dartCodeConfigurationPath)
			? new RelativePattern(dartCodeConfigurationPath, autoLaunchFilename)
			: path.join("**", dartCodeConfigurationPath, autoLaunchFilename).replaceAll("\\", "/");

		const watcher = workspace.createFileSystemWatcher(watcherPattern, false, true, true);
		this.disposables.push(watcher);
		this.disposables.push(watcher.onDidCreate((uri) => {
			// If there are any existing debug sessions, don't spawn more because we don't know they don't overlap.
			if (debug.activeDebugSession)
				return;

			void this.handleChange(uri);
		}));

		// If there are any existing debug sessions, don't spawn more because we don't know they don't overlap.
		if (debug.activeDebugSession)
			return;

		if (path.isAbsolute(dartCodeConfigurationPath)) {
			void this.handleChange(Uri.file(path.join(dartCodeConfigurationPath, autoLaunchFilename)));
		} else {
			if (workspace.workspaceFolders) {
				for (const wf of workspace.workspaceFolders) {
					void this.handleChange(Uri.joinPath(wf.uri, dartCodeConfigurationPath, autoLaunchFilename));
				}
			}
		}
	}

	private async handleChange(uri: Uri): Promise<void> {
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

					await this.startDebugSession(wf, configuration as DebugConfiguration);
				}
			}
		} catch (e: any) {
			if (e.code === "ENOENT") {
				this.logger.warn(`Failed to process autolaunch file ${uri}: ${e}`);
				// File not found, silently ignore
				return;
			}
			this.logger.warn(`Failed to process autolaunch file ${uri}: ${e}`);
		}
	}

	public async startDebugSession(wf: WorkspaceFolder | undefined, configuration: DebugConfiguration): Promise<void> {
		// If this configuration targets a device, allow time for it to appear because starting the
		// daemon and getting device events may take a little time.
		try {
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

			await debug.startDebugging(wf, configuration);
		} catch (e: any) {
			this.logger.warn(`Failed to start debugging session from autolaunch file: ${e}`);
		}
	}

	public dispose(): void | Promise<void> {
		disposeAll(this.disposables);
	}
}
