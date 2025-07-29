import * as fs from "fs";
import * as path from "path";
import { debug, DebugConfiguration, RelativePattern, Uri, workspace, WorkspaceFolder } from "vscode";
import * as ws from "ws";
import { autoLaunchFilename, thirtySecondsInMs } from "../constants";
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
						this.logger.warn(`[AutoLaunch] Ignoring configuration without name in autolaunch file ${uri}`);
						continue;
					}
					if (type !== "dart") {
						this.logger.warn(`[AutoLaunch] Ignoring non-dart configuration in autolaunch file ${uri}`);
						continue;
					}
					if (request !== "launch" && request !== "attach") {
						this.logger.warn(`[AutoLaunch] Ignoring configuration with invalid request (${request}) in autolaunch file ${uri}`);
						continue;
					}

					await this.startDebugSession(wf, configuration as DebugConfiguration);
				}
			}
		} catch (e: any) {
			if (e.code === "ENOENT") {
				// File not found, silently ignore
				return;
			}
			this.logger.warn(`[AutoLaunch] Failed to process autolaunch file ${uri}: ${e}`);
		}
	}

	private async waitForVmService(vmServiceUri: string, timeoutMs: number): Promise<boolean> {
		this.logger.info(`[AutoLaunch] Waiting for VM Service at ${vmServiceUri} to become accessible (timeout: ${timeoutMs}ms)...`);

		const startTime = Date.now();
		const retryDelayMs = 1000; // Wait 1s between attempts.

		while (Date.now() - startTime < timeoutMs) {
			try {
				await new Promise<void>((resolve, reject) => {
					// Use a 2-second timeout for each connection attempt.
					const connectionAttemptTimeoutMs = 2000;
					const socket = new ws.WebSocket(vmServiceUri, { handshakeTimeout: connectionAttemptTimeoutMs });

					const cleanup = () => {
						// To avoid race conditions, ensure we only close if it's not already closed.
						if (socket.readyState === ws.OPEN || socket.readyState === ws.CONNECTING)
							socket.close();
					};

					socket.on("open", () => {
						cleanup();
						resolve();
					});

					socket.on("error", (error) => {
						cleanup();
						reject(error);
					});
				});

				// If we get here, the connection succeeded.
				this.logger.info(`[AutoLaunch] Successfully connected to VM Service at ${vmServiceUri}, will launch debug session!`);
				return true;
			} catch (error) {
				// Stop if we've hit the timeout.
				const elapsedTime = Date.now() - startTime;
				if (elapsedTime >= timeoutMs) {
					this.logger.warn(`[AutoLaunch] Failed to connect to VM Service at ${vmServiceUri} after ${timeoutMs}ms: ${error}`);
					return false;
				}

				// Otherwise, retry.
				this.logger.info(`[AutoLaunch] Failed to connect to VM Service, will retry: ${error}`);
				await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
			}
		}

		return false;
	}

	public async startDebugSession(wf: WorkspaceFolder | undefined, configuration: DebugConfiguration): Promise<void> {
		// If configuration has vmServiceUri and waitForVmServiceMs, probe the VM Service to ensure we can connect first.
		const vmServiceUri = configuration.vmServiceUri as string | undefined;
		const waitForVmServiceMs = configuration.waitForVmServiceMs as number | undefined;
		if (vmServiceUri && waitForVmServiceMs) {
			const isVmServiceReady = await this.waitForVmService(vmServiceUri, waitForVmServiceMs);
			if (!isVmServiceReady) {
				this.logger.warn(`[AutoLaunch] Failed to autolaunch because VM Service at ${vmServiceUri} was not accessible within ${waitForVmServiceMs}ms`);
				return;
			}
		}

		// If this configuration targets a device, allow time for it to appear because starting the
		// daemon and getting device events may take a little time.
		try {
			const deviceId = configuration.deviceId as string | undefined;
			if (this.deviceManager && deviceId) {
				await this.deviceManager.waitForDevice(deviceId, thirtySecondsInMs);
				if (!this.deviceManager.getDevice(deviceId)) {
					this.logger.warn(`[AutoLaunch] Failed to autolaunch because device ${deviceId} was not found`);
					return;
				}
			}

			await debug.startDebugging(wf, configuration);
		} catch (e: any) {
			this.logger.warn(`[AutoLaunch] Failed to start debugging session from autolaunch file: ${e}`);
		}
	}

	public dispose(): void | Promise<void> {
		disposeAll(this.disposables);
	}
}
