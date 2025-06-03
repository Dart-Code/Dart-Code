import { commands, env, ExtensionContext, TextEditor, window, workspace } from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { CommandSource, restartReasonManual } from "../../shared/constants";
import { DTD_AVAILABLE } from "../../shared/constants.contexts";
import { DebuggerType } from "../../shared/enums";
import { Device } from "../../shared/flutter/daemon_interfaces";
import { DartSdks, IAmDisposable, Logger } from "../../shared/interfaces";
import { DartToolingDaemon } from "../../shared/services/tooling_daemon";
import { ActiveLocationChangedEvent, EditorDebugSession, EditorDevice, EnablePlatformTypeParams, EventKind, HotReloadParams, HotRestartParams, OpenDevToolsPageParams, SelectDeviceParams, Service, ServiceMethod, Stream } from "../../shared/services/tooling_daemon_services";
import { disposeAll, nullToUndefined, PromiseCompleter } from "../../shared/utils";
import { forceWindowsDriveLetterToUppercaseInUriString } from "../../shared/utils/fs";
import { ANALYSIS_FILTERS } from "../../shared/vscode/constants";
import { FlutterDeviceManager } from "../../shared/vscode/device_manager";
import { DartDebugSessionInformation } from "../../shared/vscode/interfaces";
import { getLanguageStatusItem } from "../../shared/vscode/status_bar";
import { envUtils, getDartWorkspaceFolders } from "../../shared/vscode/utils";
import { DebugCommands, debugSessionChanged, debugSessions, debugSessionStarted, debugSessionStopped } from "../commands/debug";
import { config } from "../config";
import { DevToolsLocation } from "../sdk/dev_tools/manager";
import { promptToReloadExtension } from "../utils";
import { getToolEnv } from "../utils/processes";

export class VsCodeDartToolingDaemon extends DartToolingDaemon {
	private readonly statusBarItem = getLanguageStatusItem("dart.toolingDaemon", ANALYSIS_FILTERS);
	private readonly editorServices: EditorServices;
	private sendActiveLocationDebounceTimer: NodeJS.Timeout | undefined;
	private readonly activeLocationDebounceTimeMs = config.dtdEditorActiveLocationDelay;
	public debugCommandsCompleter = new PromiseCompleter<DebugCommands>();

	constructor(
		context: ExtensionContext,
		logger: Logger,
		sdks: DartSdks,
		dartCapabilities: DartCapabilities,
		deviceManager: FlutterDeviceManager | undefined,
	) {
		super(
			logger,
			sdks,
			dartCapabilities,
			config.toolingDaemonAdditionalArgs,
			config.maxLogLineLength,
			getToolEnv,
			(prompt?: string, buttonText?: string, offerLog?: boolean) => promptToReloadExtension(logger, prompt, buttonText, offerLog, config.toolingDaemonLogFile),
		);
		context.subscriptions.push(this);

		this.editorServices = new EditorServices(this, deviceManager);

		this.setUpStatusBarAndCommand(context);

		// Subscribe to event + send current/initial folders.
		context.subscriptions.push(workspace.onDidChangeWorkspaceFolders(() => this.sendWorkspaceRootsToDaemon()));
		this.sendWorkspaceRootsToDaemon();

		// Handle sending the current active location.
		context.subscriptions.push(window.onDidChangeActiveTextEditor((e) => this.queueActiveLocationChange(e)));
		context.subscriptions.push(window.onDidChangeTextEditorSelection((e) => this.queueActiveLocationChange(e.textEditor)));
		context.subscriptions.push(workspace.onDidChangeTextDocument((e) => {
			// If the active document changed, this is implicitly a location change because
			// the document is different now.
			if (e.document === window.activeTextEditor?.document)
				this.queueActiveLocationChange(window.activeTextEditor);
		}));
		this.queueActiveLocationChange(window.activeTextEditor);

		// Register services that we support.
		void this.connected.then(() => this.registerServices()).catch((e) => logger.error(e));
	}

	private setUpStatusBarAndCommand(context: ExtensionContext) {
		const copyUriCommand = {
			command: "dart.copyDtdUri",
			title: "copy uri",
			tooltip: "Copies the DTD endpoint URI to the clipboard",
		};

		context.subscriptions.push(commands.registerCommand("dart.copyDtdUri", async () => {
			await env.clipboard.writeText((await this.dtdUri) ?? "<dtd not available>");

			const statusBarItem = this.statusBarItem;
			statusBarItem.command = { ...copyUriCommand, title: "copied!" };
			setTimeout(() => statusBarItem.command = copyUriCommand, 1000);
		}));

		const statusBarItem = this.statusBarItem;
		statusBarItem.name = "Dart Tooling Daemon";
		statusBarItem.text = "Dart Tooling Daemon Starting…";
		void this.connected.then((connectionInfo) => {
			if (connectionInfo) {
				void commands.executeCommand("setContext", DTD_AVAILABLE, true);
				statusBarItem.text = "Dart Tooling Daemon";
				statusBarItem.command = copyUriCommand;
			}
		});
	}

	private async registerServices() {
		await Promise.all([
			this.editorServices.register(),
		]);
	}

	protected async handleOpen() {
		await super.handleOpen();

		this.onServiceRegistered(async (e) => {
			const serviceMethod = e.service ? `${e.service}.${e.method}` : e.method;
			try {
				if (serviceMethod as ServiceMethod === ServiceMethod.registerVmService) {
					await this.setUpVmServiceRegistrations();
				}
			} catch (e) {
				this.logger.error(`Failed handling registration of ${serviceMethod} service method: ${e}`);
			}
		});

		await this.streamListen("Service");
	}

	public async setUpVmServiceRegistrations() {
		// Wait for debugCommands to be provided. This is almost certainly already available
		// before this code ever runs, but the sequence of setup in extension.ts means we don't
		// have a reference for it when this class is constructed.
		const debugCommands = await this.debugCommandsCompleter.promise;

		// Handle when VM Service URIs become available (this is not the same as a debug session starting
		// because we cannot register until we have the VM Service URI).
		this.disposables.push(debugCommands.onDebugSessionVmServiceAvailable(async (session) => {
			const vmServiceUri = session.vmServiceUri;
			if (vmServiceUri) {
				const name = session.session.name;
				await this.registerVmService({ vmServiceUri, name });
			}
		}));
		// Handle when a debug session stops. It's possible DTD has already handled the VM Service closing
		// but in the case of something like a detach, that might not happen.
		this.disposables.push(debugSessionStopped(async (session) => {
			const vmServiceUri = session?.vmServiceUri;
			if (vmServiceUri) {
				await this.unregisterVmService(vmServiceUri);
			}
		}));

		// Also handle existing debug sessions that may have started prior to the service registration happening.
		for (const session of debugSessions) {
			const vmServiceUri = session.vmServiceUri;
			if (vmServiceUri) {
				const name = session.session.name;
				await this.registerVmService({ vmServiceUri, name });
			}
		}
	}


	protected async registerVmService({ name, vmServiceUri }: { name: string, vmServiceUri: string }): Promise<void> {
		try {
			const connection = await this.connected;
			if (connection) {
				const secret = connection.dtdSecret;
				let exposedUri: string | undefined = await envUtils.exposeUrl(vmServiceUri);
				if (vmServiceUri === exposedUri)
					exposedUri = undefined;
				await this.callMethod(ServiceMethod.registerVmService, {
					exposedUri,
					name,
					secret,
					uri: vmServiceUri,
				});
			}
		} catch (e) {
			this.logger.error(`Failed to register VM Service ${vmServiceUri}: $e`);
		}
	}

	protected async unregisterVmService(vmServiceUri: string): Promise<void> {
		try {
			const connection = await this.connected;
			if (connection) {
				const secret = connection.dtdSecret;
				await this.callMethod(ServiceMethod.unregisterVmService, {
					secret,
					uri: vmServiceUri,
				});
			}
		} catch (e) {
			this.logger.error(`Failed to unregister VM Service ${vmServiceUri}: $e`);
		}
	}

	protected handleClose() {
		// If we failed to start up, overwrite the "Starting..." label and provide a restart option.
		const statusBarItem = this.statusBarItem;
		statusBarItem.text = "Dart Tooling Daemon Terminated";
		statusBarItem.command = {
			arguments: ["DTD terminated status bar item"],
			command: "_dart.reloadExtension",
			title: "restart",
		};
		super.handleClose();
	}

	private sendWorkspaceRootsToDaemon() {
		const workspaceFolderRootUris = getDartWorkspaceFolders().map((wf) => wf.uri.toString());
		void this.sendWorkspaceFolders(workspaceFolderRootUris);
	}

	private queueActiveLocationChange(editor: TextEditor | undefined) {
		// We currently assume we only want this when we're on an SDK with LSP over DTD support.
		if (!this.dartCapabilities.supportsLspOverDtd) return;

		if (this.sendActiveLocationDebounceTimer)
			clearTimeout(this.sendActiveLocationDebounceTimer);
		this.sendActiveLocationDebounceTimer = setTimeout(() => this.sendActiveLocationChange(editor), this.activeLocationDebounceTimeMs);
	}

	private sendActiveLocationChange(editor: TextEditor | undefined) {
		// Usually we only send the change if the editor whose selection changed is still
		// the active editor. However, if the active editor is a "non-editor" (for example an Output pane
		// or embedded Widget Inspector), we will still allow this, to support selection changes triggered
		// by the inspector when the inspector retains focus.
		if (window.activeTextEditor && editor !== window.activeTextEditor) {
			return;
		}

		const document = editor?.document;

		const location: ActiveLocationChangedEvent = {
			kind: EventKind.activeLocationChanged,
			selections: editor?.selections.map((s) => ({
				active: {
					character: s.active.character,
					line: s.active.line,
				},
				anchor: {
					character: s.anchor.character,
					line: s.anchor.line,
				},
			})) ?? [],
			textDocument: document ? {
				uri: forceWindowsDriveLetterToUppercaseInUriString(document.uri.toString()),
				version: document.version,
			} : undefined,
		};
		void this.sendActiveLocation(location);
	}

	public dispose() {
		void commands.executeCommand("setContext", DTD_AVAILABLE, false);
		super.dispose();
	}
}

class EditorServices implements IAmDisposable {
	protected readonly disposables: IAmDisposable[] = [];

	constructor(
		private readonly daemon: DartToolingDaemon,
		private readonly deviceManager: FlutterDeviceManager | undefined,
	) { }

	async register(): Promise<void> {
		if (this.deviceManager) {
			this.disposables.push(this.deviceManager.onDeviceAdded(async (device) => {
				const supportedTypes = await this.deviceManager?.getSupportedPlatformsForWorkspace();
				const isSupported = (d: Device) => this.deviceManager?.isSupported(supportedTypes, d) ?? true;
				this.daemon.sendEvent(Stream.Editor, { kind: EventKind.deviceAdded, device: this.asDtdEditorDevice(device, isSupported(device)) });
			}, this));
			this.disposables.push(this.deviceManager.onDeviceRemoved((deviceId) => {
				this.daemon.sendEvent(Stream.Editor, { kind: EventKind.deviceRemoved, deviceId });
			}, this));
			this.disposables.push(this.deviceManager.onDeviceChanged(async (device) => {
				const supportedTypes = await this.deviceManager?.getSupportedPlatformsForWorkspace();
				const isSupported = (d: Device) => this.deviceManager?.isSupported(supportedTypes, d) ?? true;
				this.daemon.sendEvent(Stream.Editor, { kind: EventKind.deviceChanged, device: this.asDtdEditorDevice(device, isSupported(device)) });
			}, this));
			this.disposables.push(this.deviceManager.onCurrentDeviceChanged((device) => {
				this.daemon.sendEvent(Stream.Editor, { kind: EventKind.deviceSelected, deviceId: device?.id });
			}, this));
		}

		this.disposables.push(debugSessionStarted((session) => {
			this.daemon.sendEvent(Stream.Editor, { kind: EventKind.debugSessionStarted, debugSession: this.asDtdEditorDebugSession(session) });
		}, this));
		this.disposables.push(debugSessionStopped((session) => {
			this.daemon.sendEvent(Stream.Editor, { kind: EventKind.debugSessionStopped, debugSessionId: session.session.id });
		}, this));
		this.disposables.push(debugSessionChanged((session) => {
			this.daemon.sendEvent(Stream.Editor, { kind: EventKind.debugSessionChanged, debugSession: this.asDtdEditorDebugSession(session) });
		}, this));

		await Promise.all([
			this.deviceManager
				? this.daemon.registerService(Service.Editor, "getDevices", undefined, async () => {
					const supportedTypes = await this.deviceManager?.getSupportedPlatformsForWorkspace();
					const isSupported = (d: Device) => this.deviceManager?.isSupported(supportedTypes, d) ?? true;
					return {
						devices: this.deviceManager?.getDevicesSortedByName().map((d) => this.asDtdEditorDevice(d, isSupported(d))) ?? [],
						selectedDeviceId: this.deviceManager?.currentDevice?.id,
						type: "GetDevicesResult",
					};
				})
				: undefined,
			this.daemon.registerService(Service.Editor, "getDebugSessions", undefined, () => ({
				debugSessions: debugSessions.map((d) => this.asDtdEditorDebugSession(d)),
				type: "GetDebugSessionsResult",
			})),
			this.deviceManager
				? this.daemon.registerService(Service.Editor, "selectDevice", undefined, async (params: SelectDeviceParams) => {
					await this.deviceManager?.selectDeviceById(params.deviceId);
					return { type: "Success" };
				})
				: undefined,
			this.deviceManager
				? this.daemon.registerService(Service.Editor, "enablePlatformType", undefined, async (params: EnablePlatformTypeParams) => {
					await this.deviceManager?.enablePlatformType(params.platformType);
					return { type: "Success" };
				})
				: undefined, ,
			this.daemon.registerService(Service.Editor, "hotReload", undefined, async (params: HotReloadParams) => {
				const session = debugSessions.find((s) => s.session.id === params.debugSessionId);
				if (session)
					await session.session.customRequest("hotReload", { reason: restartReasonManual });
				return { type: "Success" };
			}),
			this.daemon.registerService(Service.Editor, "hotRestart", undefined, async (params: HotRestartParams) => {
				const session = debugSessions.find((s) => s.session.id === params.debugSessionId);
				if (session)
					await session.session.customRequest("hotRestart", { reason: restartReasonManual });
				return { type: "Success" };
			}),
			this.daemon.registerService(
				Service.Editor, "openDevToolsPage",
				{
					supportsForceExternal: true,
				},
				async (params: OpenDevToolsPageParams) => {
					const location: DevToolsLocation | undefined = params.forceExternal ? "external" : undefined;
					await commands.executeCommand(
						"dart.openDevTools",
						{
							commandSource: CommandSource.dtdServiceRequest,
							debugSessionId: params.debugSessionId,
							location,
							pageId: params.page,
							prefersDebugSession: params.prefersDebugSession,
							requiresDebugSession: params.requiresDebugSession,
						});
					return { type: "Success" };
				},
			),
		]);
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}

	private asDtdEditorDevice(device: Device, supported: boolean): EditorDevice {
		return {
			category: nullToUndefined(device.category),
			emulator: !!device.emulator,
			emulatorId: nullToUndefined(device.emulatorId),
			ephemeral: !!device.ephemeral,
			id: device.id,
			name: this.deviceManager?.friendlyNameForDevice(device) ?? device.name,
			platform: device.platform,
			platformType: nullToUndefined(device.platformType),
			rawDeviceName: device.name,
			supported,
		};
	}

	private asDtdEditorDebugSession(session: DartDebugSessionInformation): EditorDebugSession {
		return {
			debuggerType: DebuggerType[session.debuggerType],
			flutterDeviceId: session.flutterDeviceId,
			flutterMode: session.flutterMode,
			id: session.session.id,
			name: session.session.name,
			projectRootPath: session.projectRootPath,
			vmServiceUri: session.vmServiceUri,
		};
	}
}
