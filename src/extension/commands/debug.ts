import * as path from "path";
import * as vs from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { CommandSource, debugLaunchProgressId, debugTerminatingProgressId, devToolsPages, doNotAskAgainAction, widgetInspectorPage } from "../../shared/constants";
import { isInDartDebugSessionContext, isInFlutterDebugModeDebugSessionContext, isInFlutterProfileModeDebugSessionContext, isInFlutterReleaseModeDebugSessionContext } from "../../shared/constants.contexts";
import { DebugOption, DebuggerType, LogSeverity, VmService, VmServiceExtension, debugOptionNames } from "../../shared/enums";
import { DartWorkspaceContext, IAmDisposable, LogMessage, Logger, WidgetErrorInspectData } from "../../shared/interfaces";
import { PromiseCompleter, disposeAll } from "../../shared/utils";
import { fsPath, isFlutterProjectFolder, isWithinPath } from "../../shared/utils/fs";
import { ANALYSIS_FILTERS } from "../../shared/vscode/constants";
import { getLaunchConfigDefaultTemplate } from "../../shared/vscode/debugger";
import { getLanguageStatusItem } from "../../shared/vscode/status_bar";
import { showDevToolsNotificationIfAppropriate } from "../../shared/vscode/user_prompts";
import { envUtils } from "../../shared/vscode/utils";
import { Context } from "../../shared/vscode/workspace";
import { LspFileTracker } from "../analysis/file_tracker_lsp";
import { config } from "../config";
import { VmServiceExtensions, timeDilationNormal, timeDilationSlow } from "../flutter/vm_service_extensions";
import { locateBestProjectRoot } from "../project";
import { DevToolsLocation, DevToolsManager } from "../sdk/dev_tools/manager";
import { isDartFile, isValidEntryFile } from "../utils";
import { DartDebugSessionInformation, ProgressMessage } from "../utils/vscode/debug";

export const debugSessions: DartDebugSessionInformation[] = [];
const debugSessionsChangedEmitter = new vs.EventEmitter<void>();
export const debugSessionsChanged = debugSessionsChangedEmitter.event;

const CURRENT_FILE_RUNNABLE = "dart-code:currentFileIsRunnable";

// Workaround for https://github.com/microsoft/vscode/issues/100115
const dynamicDebugSessionName = "Dart ";

// As a workaround for https://github.com/Microsoft/vscode/issues/71651 we
// will keep any events that arrive before their session "started" and then
// replace them when the start event comes through.
let pendingCustomEvents: vs.DebugSessionCustomEvent[] = [];

let hasPromptedAboutDebugSettings = false;

export let isInDartDebugSession = false;
export let isInFlutterDebugModeDebugSession = false;
export let isInFlutterProfileModeDebugSession = false;

export class LastDebugSession {
	public static workspaceFolder?: vs.WorkspaceFolder;
	public static debugConfig?: vs.DebugConfiguration;
}

export class LastTestDebugSession {
	public static workspaceFolder?: vs.WorkspaceFolder;
	public static debugConfig?: vs.DebugConfiguration;
}

export class DebugCommands implements IAmDisposable {
	protected readonly disposables: vs.Disposable[] = [];
	private debugOptions = vs.window.createStatusBarItem("dartStatusDebugOptions", vs.StatusBarAlignment.Left, 0);
	private currentDebugOption = DebugOption.MyCode;
	private debugMetrics = vs.window.createStatusBarItem("dartStatusDebugMetrics", vs.StatusBarAlignment.Right, 0);
	private readonly debugSessionsStatusItem = getLanguageStatusItem("dart.debugSessions", ANALYSIS_FILTERS);
	private onWillHotReloadEmitter = new vs.EventEmitter<void>();
	public readonly onWillHotReload = this.onWillHotReloadEmitter.event;
	private onWillHotRestartEmitter = new vs.EventEmitter<void>();
	public readonly onWillHotRestart = this.onWillHotRestartEmitter.event;
	private onDebugSessionVmServiceAvailableEmitter = new vs.EventEmitter<DartDebugSessionInformation>();
	public readonly onDebugSessionVmServiceAvailable = this.onDebugSessionVmServiceAvailableEmitter.event;
	public readonly vmServices: VmServiceExtensions;
	private suppressFlutterWidgetErrors = false;

	public isInspectingWidget = false;
	private autoCancelNextInspectWidgetMode = false;

	constructor(private readonly logger: Logger, private readonly fileTracker: LspFileTracker | undefined, private context: Context, private workspaceContext: DartWorkspaceContext, readonly dartCapabilities: DartCapabilities, readonly flutterCapabilities: FlutterCapabilities, private readonly devTools: DevToolsManager) {
		this.vmServices = new VmServiceExtensions(logger, this, workspaceContext, flutterCapabilities);
		this.devTools.debugCommands = this;
		this.debugOptions.name = "Dart Debug Options";
		this.disposables.push(this.debugOptions);
		this.debugMetrics.name = "Dart Debug Metrics";
		this.disposables.push(this.debugMetrics);
		this.debugSessionsStatusItem.name = "Dart Debug Sessions";
		this.updateDebugSessionsStatus();

		this.disposables.push(vs.debug.onDidChangeBreakpoints((e) => this.handleBreakpointChange(e)));
		this.disposables.push(vs.debug.onDidStartDebugSession((s) => this.handleDebugSessionStart(s)));
		this.disposables.push(vs.debug.onDidReceiveDebugSessionCustomEvent((e) => this.handleDebugSessionCustomEvent(e)));
		this.disposables.push(vs.debug.onDidTerminateDebugSession((s) => this.handleDebugSessionEnd(s)));

		// Handle enabling Run/Debug buttons for the file if an entry point or have a main() method.
		if (this.fileTracker)
			this.disposables.push(this.fileTracker.onOutline(() => this.updateRunnableContexts()));
		this.disposables.push(vs.window.onDidChangeActiveTextEditor(() => this.updateRunnableContexts()));
		// Run for current open editor.
		this.updateRunnableContexts();

		this.disposables.push(vs.commands.registerCommand("flutter.overridePlatform", () => this.vmServices.overridePlatform()));
		this.disposables.push(vs.commands.registerCommand("flutter.toggleDebugPainting", () => this.vmServices.toggle(VmServiceExtension.DebugPaint)));
		this.disposables.push(vs.commands.registerCommand("flutter.togglePerformanceOverlay", () => this.vmServices.toggle(VmServiceExtension.PerformanceOverlay)));
		this.disposables.push(vs.commands.registerCommand("flutter.toggleBrightness", () => this.vmServices.toggle(VmServiceExtension.BrightnessOverride, "Brightness.dark", "Brightness.light")));
		this.disposables.push(vs.commands.registerCommand("flutter.toggleRepaintRainbow", () => this.vmServices.toggle(VmServiceExtension.RepaintRainbow)));
		this.disposables.push(vs.commands.registerCommand("flutter.toggleDebugModeBanner", () => this.vmServices.toggle(VmServiceExtension.DebugBanner)));
		this.disposables.push(vs.commands.registerCommand("flutter.togglePaintBaselines", () => this.vmServices.toggle(VmServiceExtension.PaintBaselines)));
		this.disposables.push(vs.commands.registerCommand("flutter.toggleSlowAnimations", () => this.vmServices.toggle(VmServiceExtension.SlowAnimations, timeDilationNormal, timeDilationSlow)));
		this.disposables.push(vs.commands.registerCommand("flutter.inspectWidget", () => {
			this.autoCancelNextInspectWidgetMode = false;
			void this.vmServices.toggle(VmServiceExtension.InspectorSelectMode, true, true);
		}));
		this.disposables.push(vs.commands.registerCommand("flutter.inspectWidget.autoCancel", () => {
			this.autoCancelNextInspectWidgetMode = true;
			void this.vmServices.toggle(VmServiceExtension.InspectorSelectMode, true, true);
		}));
		this.disposables.push(vs.commands.registerCommand("flutter.cancelInspectWidget", () => {
			this.autoCancelNextInspectWidgetMode = false;
			void this.vmServices.toggle(VmServiceExtension.InspectorSelectMode, false, false);
		}));

		this.disposables.push(vs.commands.registerCommand("dart.openObservatory", async () => {
			const session = await this.getDebugSession();
			if (session && !session.session.configuration.noDebug && session.observatoryUri) {
				await envUtils.openInBrowser(session.observatoryUri);
			} else if (session) {
				logger.warn("Cannot start Observatory for session without debug/observatoryUri");
			}
		}));
		this.disposables.push(vs.commands.registerCommand("dart.copyVmServiceUri", async () => {
			const session = await this.getDebugSession();
			if (!session) {
				await vs.window.showInformationMessage("No Dart/Flutter debug session available");
				return;
			}
			const vmUri = session?.vmServiceUri;
			if (!vmUri) {
				if (session?.hasStarted)
					await vs.window.showInformationMessage("This debug session does not have a VM Service");
				else
					await vs.window.showInformationMessage("This debug session is not ready yet");
				return;
			}
			await vs.env.clipboard.writeText(vmUri.toString());
		}));
		this.disposables.push(vs.commands.registerCommand("dart.openDevTools.external", () => vs.commands.executeCommand("dart.openDevTools", { commandSource: CommandSource.commandPalette, location: "external" as DevToolsLocation })));
		this.disposables.push(vs.commands.registerCommand("_dart.openDevTools.touchBar", () => vs.commands.executeCommand("dart.openDevTools", { commandSource: CommandSource.touchbar })));
		devToolsPages.forEach((page) => {
			void vs.commands.executeCommand("setContext", `dart-code:devToolsSupports${page.commandSuffix}`, this.devTools.isPageAvailable(true, page));
			this.disposables.push(vs.commands.registerCommand(`dart.openDevTools${page.commandSuffix}`, async (options?: { debugSessionId?: string, triggeredAutomatically?: boolean }): Promise<{ url: string, dispose: () => void } | undefined> => {
				options = Object.assign({}, options, { pageId: page.id });
				return vs.commands.executeCommand("dart.openDevTools", options);
			}));
		});
		this.disposables.push(vs.commands.registerCommand("flutter.openDevTools.sidebar", () => vs.commands.executeCommand("flutter.openDevTools", { commandSource: CommandSource.sidebarTitle })));
		this.disposables.push(vs.commands.registerCommand("flutter.openDevTools", async (options?: { debugSessionId?: string, triggeredAutomatically?: boolean, pageId?: string, commandSource?: string }): Promise<{ url: string, dispose: () => void } | undefined> =>
			vs.commands.executeCommand("dart.openDevTools", options)));
		this.disposables.push(vs.commands.registerCommand("dart.openDevTools", async (options?: { debugSessionId?: string, triggeredAutomatically?: boolean, pageId?: string, location?: DevToolsLocation, commandSource?: string, requiresDebugSession?: boolean, prefersDebugSession?: boolean }): Promise<{ url: string, dispose: () => void } | undefined> => {
			const commandSource = options?.commandSource ?? CommandSource.commandPalette;
			const pageId = options?.pageId;
			const location = options?.location;
			const triggeredAutomatically = options?.triggeredAutomatically;
			let requiresDebugSession = options?.requiresDebugSession;
			const prefersDebugSession = options?.prefersDebugSession;

			// Check whether we'll need a Debug Session to open this page.
			const page = devToolsPages.find((p) => p.id === pageId);
			const isKnownStaticPage = page && page.isStaticTool;
			requiresDebugSession = requiresDebugSession ?? !isKnownStaticPage;

			let session: DartDebugSessionInformation | undefined;
			if (requiresDebugSession || (prefersDebugSession && debugSessions.length)) {
				session = options?.debugSessionId
					? debugSessions.find((s) => s.session.id === options.debugSessionId)
					: await this.getDebugSession();
				if (!session)
					return; // User cancelled or specified session was gone
			}

			// Only show a notification if we were not triggered automatically.
			const notify = !options || triggeredAutomatically !== true;

			if (!session || session?.vmServiceUri) {
				return this.devTools.spawn(session as DartDebugSessionInformation & { vmServiceUri: string }, { notify, pageId, commandSource, location, triggeredAutomatically });
			} else if (session.session.configuration.noDebug) {
				void vs.window.showInformationMessage("You must start your app with debugging in order to use DevTools.");
			} else if (session.hasStarted && session.flutterMode && session.flutterDeviceId) {
				void vs.window.showInformationMessage(`DevTools is not available for an app running in ${session.flutterMode} mode on device '${session.flutterDeviceId}'.`);
			} else if (session.hasStarted) {
				void vs.window.showInformationMessage("DevTools is not available for an app running in this mode.");
			} else {
				void vs.window.showInformationMessage("This debug session is not ready yet.");
			}
		}));

		// Misc custom debug commands.
		this.disposables.push(vs.commands.registerCommand("_dart.hotReload.touchBar", (args: any) => vs.commands.executeCommand("_dart.hotReload.withSave", args)));
		this.disposables.push(vs.commands.registerCommand("flutter.hotReload", (args: any) => vs.commands.executeCommand("dart.hotReload", args)));
		this.disposables.push(vs.commands.registerCommand("_dart.hotReload.withSave", async (args?: any) => {
			try {
				const hasDirtyFiles = !!vs.workspace.textDocuments.find((td) => td.isDirty);
				if (hasDirtyFiles) {
					// Trigger save, but don't wait more than 100ms because if the user has configured codeActionsOnSave this might
					// take a while. A request for a better API is here:
					//   https://github.com/microsoft/vscode/issues/191639
					await Promise.race([
						vs.workspace.saveAll(false),
						new Promise((resolve) => setTimeout(resolve, 100)),
					]);
				}
			} finally {
				await vs.commands.executeCommand("dart.hotReload");
			}
		}));
		this.disposables.push(vs.commands.registerCommand("dart.hotReload", async (args?: any) => {
			if (!debugSessions.length)
				return;
			const onlyDart = !!args?.onlyDart;
			const onlyFlutter = !!args?.onlyFlutter;

			this.onWillHotReloadEmitter.fire();
			await Promise.all(debugSessions.map(async (s) => {
				const shouldReload = onlyDart
					? (s.debuggerType === DebuggerType.Dart || s.debuggerType === DebuggerType.Web)
					: onlyFlutter
						? (s.debuggerType === DebuggerType.Flutter)
						: true;
				if (shouldReload)
					await s.session.customRequest("hotReload", args);
			}));
		}));
		this.disposables.push(vs.commands.registerCommand("flutter.hotRestart", async (args?: any) => {
			if (!debugSessions.length)
				return;
			this.onWillHotRestartEmitter.fire();
			await Promise.all(debugSessions.map((s) => s.session.customRequest("hotRestart", args)));
		}));
		this.disposables.push(vs.commands.registerCommand("dart.startDebugging", async (arg: vs.Uri | { resource: vs.Uri, launchTemplate?: any | undefined }) => {
			const resource = "resource" in arg ? arg.resource : arg;
			let launchTemplate = "launchTemplate" in arg ? arg.launchTemplate : undefined;
			launchTemplate ??= getLaunchConfigDefaultTemplate(resource, true);

			const launchConfig = Object.assign(
				{
					name: dynamicDebugSessionName,
					noDebug: false,
					request: "launch",
					type: "dart",
				},
				launchTemplate,
				{
					program: fsPath(resource),
				},
			);
			await vs.debug.startDebugging(vs.workspace.getWorkspaceFolder(resource), launchConfig as vs.DebugConfiguration);
		}));
		this.disposables.push(vs.commands.registerCommand("dart.startWithoutDebugging", async (arg: vs.Uri | { resource: vs.Uri, launchTemplate?: any | undefined }) => {
			const resource = "resource" in arg ? arg.resource : arg;
			let launchTemplate = "launchTemplate" in arg ? arg.launchTemplate : undefined;
			launchTemplate ??= getLaunchConfigDefaultTemplate(resource, false);

			const launchConfig = Object.assign(
				{
					name: dynamicDebugSessionName,
					noDebug: true,
					request: "launch",
					type: "dart",
				},
				launchTemplate,
				{
					program: fsPath(resource),
				},
			);
			await vs.debug.startDebugging(vs.workspace.getWorkspaceFolder(resource), launchConfig as vs.DebugConfiguration);
		}));
		this.disposables.push(vs.commands.registerCommand("dart.createLaunchConfiguration", this.createLaunchConfiguration, this));
		this.disposables.push(vs.commands.registerCommand("dart.rerunLastDebugSession", async () => {
			if (LastDebugSession.debugConfig) {
				await vs.debug.startDebugging(LastDebugSession.workspaceFolder, LastDebugSession.debugConfig);
			} else {
				void vs.window.showErrorMessage("There is no previous debug session to run.");
			}
		}));
		this.disposables.push(vs.commands.registerCommand("dart.rerunLastTestDebugSession", async () => {
			if (LastTestDebugSession.debugConfig) {
				await vs.debug.startDebugging(LastTestDebugSession.workspaceFolder, LastTestDebugSession.debugConfig);
			} else {
				void vs.window.showErrorMessage("There is no previous test session to run.");
			}
		}));

		// Attach commands.
		this.disposables.push(vs.commands.registerCommand("dart.attach", async () => {
			await vs.debug.startDebugging(undefined, {
				name: "Dart: Attach to Process",
				request: "attach",
				type: "dart",
			});
		}));
		this.disposables.push(vs.commands.registerCommand("flutter.attachProcess", async () => {
			await vs.debug.startDebugging(undefined, {
				name: "Flutter: Attach to Process",
				request: "attach",
				type: "dart",
				vmServiceUri: "${command:dart.promptForVmService}",
			});
		}));
		this.disposables.push(vs.commands.registerCommand("flutter.runProfileMode", async () => {
			await vs.debug.startDebugging(undefined, {
				flutterMode: "profile",
				name: "Flutter: Run in Profile Mode",
				openDevTools: "performance",
				request: "launch",
				type: "dart",
			});
			if (!this.context.hasNotifiedAboutProfileModeDefaultConfiguration) {
				this.context.hasNotifiedAboutProfileModeDefaultConfiguration = true;
				void vs.window.showInformationMessage("Profiling Flutter app with default configuration. To customize this, create a launch configuration (and include 'flutterMode': 'profile').");
			}
		}));
		this.disposables.push(vs.commands.registerCommand("flutter.runReleaseMode", async () => {
			await vs.debug.startDebugging(undefined, {
				flutterMode: "release",
				name: "Flutter: Run in Release Mode",
				request: "launch",
				type: "dart",
			});
		}));
		this.disposables.push(vs.commands.registerCommand("flutter.attach", async () => {
			await vs.debug.startDebugging(undefined, {
				name: "Flutter: Attach to Device",
				request: "attach",
				type: "dart",
			});
		}));
		this.disposables.push(vs.commands.registerCommand("dart.promptForVmService", async (defaultValueOrConfig: string | vs.DebugConfiguration | undefined): Promise<string | undefined> => {
			const defaultValue = typeof defaultValueOrConfig === "string" ? defaultValueOrConfig : undefined;
			return vs.window.showInputBox({
				ignoreFocusOut: true, // Don't close the window if the user tabs away to get the uri
				placeHolder: "Paste an VM Service URI",
				prompt: "Enter VM Service URI",
				validateInput: (input) => {
					if (!input)
						return;

					input = input.trim();

					// eslint-disable-next-line id-blacklist
					if (Number.isInteger(parseFloat(input)))
						return;

					// Uri.parse doesn't seem to work as expected, so do our own basic validation
					// https://github.com/Microsoft/vscode/issues/49818

					if (!input.startsWith("http://") && !input.startsWith("https://")
						&& !input.startsWith("ws://") && !input.startsWith("wss://"))
						return "Please enter a valid VM Service URI";
				},
				value: defaultValue,
			});
		}));

		// Debug options.
		if (config.debugSdkLibraries && config.debugExternalPackageLibraries)
			this.currentDebugOption = DebugOption.MyCodePackagesSdk;
		else if (config.debugSdkLibraries)
			this.currentDebugOption = DebugOption.MyCodeSdk;
		else if (config.debugExternalPackageLibraries)
			this.currentDebugOption = DebugOption.MyCodePackages;
		this.disposables.push(vs.commands.registerCommand("_dart.toggleDebugOptions", this.toggleDebugOptions, this));
		this.debugOptions.text = `Debug ${debugOptionNames[this.currentDebugOption]}`;
		this.debugOptions.tooltip = `Controls whether to step into or stop at breakpoints in only files in this workspace or also those in SDK and/or external Pub packages`;
		this.debugOptions.command = "_dart.toggleDebugOptions";
	}

	private async createLaunchConfiguration(resourceUri: vs.Uri) {
		if (!resourceUri || resourceUri.scheme !== "file")
			return;

		const entryScriptPath = fsPath(resourceUri);
		if (!isDartFile(entryScriptPath))
			return;

		const workspaceFolder = vs.workspace.getWorkspaceFolder(resourceUri);
		if (!workspaceFolder)
			return;

		const workspaceFolderPath = fsPath(workspaceFolder.uri);
		const projectFolderPath = locateBestProjectRoot(entryScriptPath) ?? workspaceFolderPath;
		const relativeCwdPath = path.relative(workspaceFolderPath, projectFolderPath);
		const relativeEntryScriptPath = path.relative(projectFolderPath, entryScriptPath);


		const projectType = isFlutterProjectFolder(projectFolderPath) ? "Flutter" : "Dart";
		const name = `${projectType} (${relativeEntryScriptPath})`;
		const newLaunchConfig = {
			name,
			type: "dart",
			// eslint-disable-next-line @typescript-eslint/tslint/config
			request: "launch",
			cwd: relativeCwdPath ? relativeCwdPath : undefined,
			program: relativeEntryScriptPath,
		};

		// Add to the launch.json config.
		const launchFile = vs.workspace.getConfiguration("launch", workspaceFolder);
		// If we're in a code-workspace that already has workspace-level launch configs,
		// we should add to that. Otherwise add directly to the workspace folder.
		const configInspect = launchFile.inspect<any[]>("configurations");
		const workspaceConfigs = configInspect?.workspaceValue ?? [];
		const workspaceFolderConfigs = configInspect?.workspaceFolderValue ?? [];
		const hasWorkspaceConfigs = !!vs.workspace.workspaceFile && !!workspaceConfigs.length;
		const configs = hasWorkspaceConfigs ? workspaceConfigs : workspaceFolderConfigs;
		const target = hasWorkspaceConfigs ? vs.ConfigurationTarget.Workspace : vs.ConfigurationTarget.WorkspaceFolder;
		configs.push(newLaunchConfig);
		await launchFile.update("configurations", configs, target);

		// Open the correct file based on workspace or workspace folder.
		if (hasWorkspaceConfigs) {
			void vs.commands.executeCommand("workbench.action.openWorkspaceConfigFile");
		} else {
			const launchConfig = path.join(workspaceFolderPath, ".vscode", "launch.json");
			void vs.workspace.openTextDocument(launchConfig).then((doc) => vs.window.showTextDocument(doc));
		}
	}

	private async getDebugSession(): Promise<DartDebugSessionInformation | undefined> {
		if (debugSessions.length === 0) {
			this.logger.info("No debug session to use!");
			return undefined;
		} else if (debugSessions.length === 1) {
			this.logger.info("Using only available debug session");
			return debugSessions[0];
		} else {
			this.logger.info("Multiple debug sessions available, will prompt user:");

			const sessions = debugSessions.map((s) => ({
				description: s.session.workspaceFolder ? s.session.workspaceFolder.name : undefined,
				detail: s.session.configuration.deviceName || `Started ${s.sessionStart.toLocaleTimeString()}`,
				label: s.session.name,
				session: s,
			}));

			for (const session of sessions)
				this.logger.info(`${session.label} ${session.description} (${session.detail})`);

			const selectedItem = await vs.window.showQuickPick(sessions, { placeHolder: "Which debug session?" });

			return selectedItem && selectedItem.session;
		}
	}

	public handleBreakpointChange(e: vs.BreakpointsChangeEvent): void {
		if (hasPromptedAboutDebugSettings)
			return;

		for (const bp of e.added)
			this.promptAboutDebuggerSettingsIfBreakpointOutsideWorkspace(bp);
	}

	public promptAboutDebuggerSettingsIfBreakpointOutsideWorkspace(e: vs.Breakpoint): void {
		if (hasPromptedAboutDebugSettings || this.context.breakpointInNonDebuggableFileDoNotShowAgain || !(e instanceof vs.SourceBreakpoint) || !e.enabled)
			return;

		// Don't consider non-files or non-Dart files.
		if (e.location.uri.scheme !== "file" || !fsPath(e.location.uri).toLocaleLowerCase().endsWith(".dart"))
			return;

		// If it's inside the workspace we don't want to prompt.
		if (vs.workspace.getWorkspaceFolder(e.location.uri))
			return;

		const isSdkBreakpoint = isWithinPath(fsPath(e.location.uri), this.workspaceContext.sdks.dart);

		if (isSdkBreakpoint && config.debugSdkLibraries)
			return;
		if (!isSdkBreakpoint && config.debugExternalPackageLibraries)
			return;

		hasPromptedAboutDebugSettings = true;
		const message = `You have a breakpoint outside of your workspace but debug settings are set to 'my code'. Would you like to change settings? You can also change this from the status bar while debugging.`;

		const debugJustMyCodeAction = "Debug my code";
		const debugEverything = "Debug all code";
		void vs.window.showWarningMessage(message, debugJustMyCodeAction, debugEverything, doNotAskAgainAction).then((choice) => {
			if (choice === doNotAskAgainAction)
				this.context.breakpointInNonDebuggableFileDoNotShowAgain = true;
			if (choice !== debugEverything)
				return;

			this.currentDebugOption = DebugOption.MyCodePackagesSdk;
			this.applyNewDebugOption();
		});
	}

	private updateDebugSessionsStatus(): void {
		if (!debugSessions.length) {
			this.debugSessionsStatusItem.text = "No Debug Sessions";
			this.debugSessionsStatusItem.command = undefined;
			return;
		}

		this.debugSessionsStatusItem.text = `${debugSessions.length} Debug Session${debugSessions.length === 1 ? "" : "s"}`;
		this.debugSessionsStatusItem.command = {
			command: "dart.copyVmServiceUri",
			title: "copy vm service",
		};
	}

	public handleDebugSessionStart(s: vs.DebugSession): void {
		if (s.type !== "dart")
			return;

		const session = new DartDebugSessionInformation(s, s.configuration);
		// If we're the first fresh debug session, reset all settings to default.
		// Subsequent launches will inherit the "current" values.
		if (debugSessions.length === 0)
			this.vmServices.resetToDefaults();
		debugSessions.push(session);
		this.updateDebugSessionsStatus();
		debugSessionsChangedEmitter.fire();

		if (s.configuration.debuggerType === DebuggerType.Flutter || s.configuration.debuggerType === DebuggerType.Web) {
			// TODO(dantup): Can these use session.flutterMode in preference?
			const isProfileMode = s.configuration.toolArgs?.includes("--profile");
			const isReleaseMode = s.configuration.toolArgs?.includes("--release");

			if (isReleaseMode) {
				void vs.commands.executeCommand("setContext", isInFlutterReleaseModeDebugSessionContext, true);
			} else if (isProfileMode) {
				isInFlutterProfileModeDebugSession = true;
				void vs.commands.executeCommand("setContext", isInFlutterProfileModeDebugSessionContext, true);
			} else {
				isInFlutterDebugModeDebugSession = true;
				void vs.commands.executeCommand("setContext", isInFlutterDebugModeDebugSessionContext, true);
			}
		} else if (s.configuration.debuggerType === DebuggerType.Dart) {
			isInDartDebugSession = true;
			void vs.commands.executeCommand("setContext", isInDartDebugSessionContext, true);
		}

		// Process any queued events that came in before the session start
		// event.
		const eventsToProcess = pendingCustomEvents.filter((e) => e.session.id === s.id);
		pendingCustomEvents = pendingCustomEvents.filter((e) => e.session.id !== s.id);

		eventsToProcess.forEach((e) => {
			this.logger.info(`Processing delayed event ${e.event} for session ${e.session.id}`);
			void this.handleCustomEventWithSession(session, e);
		});

		this.debugOptions.show();
	}

	public handleDebugSessionCustomEvent(e: vs.DebugSessionCustomEvent): void {
		if (this.handleCustomEvent(e))
			return;

		const session = debugSessions.find((ds) => ds.session.id === e.session.id);
		if (!session) {
			this.logger.info(`Did not find session ${e.session.id} to handle ${e.event}. There were ${debugSessions.length} sessions:\n${debugSessions.map((ds) => `  ${ds.session.id}`).join("\n")}`);
			this.logger.info(`Event will be queued and processed when the session start event fires`);
			pendingCustomEvents.push(e);
			return;
		}
		void this.handleCustomEventWithSession(session, e);
	}

	public handleDebugSessionEnd(s: vs.DebugSession): void {
		const sessionIndex = debugSessions.findIndex((ds) => ds.session.id === s.id);
		if (sessionIndex === -1)
			return;

		// Grab the session and remove it from the list so we don't try to interact with it anymore.
		const session = debugSessions[sessionIndex];
		session.hasEnded = true;
		debugSessions.splice(sessionIndex, 1);
		this.updateDebugSessionsStatus();
		debugSessionsChangedEmitter.fire();

		// Close any in-progress progress notifications.
		for (const progressId of Object.keys(session.progress))
			session.progress[progressId]?.complete();

		const debugSessionEnd = new Date();

		// If this was the last session terminating, then remove all the flags for which service extensions are supported.
		// Really we should track these per-session, but the changes of them being different given we only support one
		// SDK at a time are practically zero.
		if (debugSessions.length === 0) {
			this.vmServices.markAllServicesUnloaded();
			this.vmServices.markAllServiceExtensionsUnloaded();
			this.debugOptions.hide();
			this.debugMetrics.hide();
			isInFlutterDebugModeDebugSession = false;
			isInFlutterProfileModeDebugSession = false;
			for (const debugContext of [
				isInDartDebugSessionContext,
				isInFlutterDebugModeDebugSessionContext,
				isInFlutterProfileModeDebugSessionContext,
				isInFlutterReleaseModeDebugSessionContext,
			])
				void vs.commands.executeCommand("setContext", debugContext, false);
		}
	}

	private handleCustomEvent(e: vs.DebugSessionCustomEvent): boolean {
		const event = e.event;
		const body = e.body;
		if (event === "dart.log") {
			const message: LogMessage = e.body;
			const logMessage = `[${e.session.name}] ${message.message}`;
			switch (message.severity) {
				case LogSeverity.Warn:
					this.logger.warn(logMessage, message.category);
					break;
				case LogSeverity.Error:
					this.logger.error(logMessage, message.category);
					break;
				default:
					this.logger.info(logMessage, message.category);
			}
		} else if (event === "dart.hotRestartRequest") {
			// This event comes back when the user restarts with the Restart button
			// (eg. it wasn't intiated from our extension, so we don't get to log it
			// in the command).
			this.onWillHotRestartEmitter.fire();
		} else if (event === "dart.hotReloadRequest") {
			// This event comes back when the user restarts with the Restart button
			// (eg. it wasn't intiated from our extension, so we don't get to log it
			// in the command).
			this.onWillHotReloadEmitter.fire();
		} else if (event === "dart.debugMetrics") {
			const memory = body.memory;
			const message = `${Math.ceil(memory.current / 1024 / 1024)}MB of ${Math.ceil(memory.total / 1024 / 1024)}MB`;
			this.debugMetrics.text = message;
			this.debugMetrics.tooltip = "This is the amount of memory being consumed by your applications heaps (out of what has been allocated).\n\nNote: memory usage shown in debug builds may not be indicative of usage in release builds. Use profile builds for more accurate figures when testing memory usage.";
			this.debugMetrics.show();
		} else if (event === "dart.toolEvent") {
			const kind = body.kind;
			const data = body.data;
			switch (kind) {
				case "navigate":
					const uri: string | undefined = data.resolvedFileUri ?? data.resolvedUri ?? data.fileUri ?? data.uri ?? data.file;
					const line: string | undefined = data.line;
					const col: string | undefined = data.column;
					const isFlutterInspectorNavigation = data.source === "flutter.inspector";
					if (uri && uri.startsWith("file://") && line && col) {
						// Only navigate if it's not from inspector, or is from inspector but we're not in full-width mode.
						const navigate = !isFlutterInspectorNavigation || this.devTools.getDevToolsLocation(widgetInspectorPage.id) !== "active";
						if (navigate)
							void vs.commands.executeCommand("_dart.jumpToLineColInUri", vs.Uri.parse(uri), line, col, true);
						if (isFlutterInspectorNavigation && this.isInspectingWidget && this.autoCancelNextInspectWidgetMode) {
							// Add a short delay because this will remove the visible selection.
							setTimeout(() => vs.commands.executeCommand("flutter.cancelInspectWidget"), 1000);
						}
					}
					break;
				default:
					return false;
			}

		} else if (event === "dart.navigate") {
			if (body.file && body.line && body.column) {
				// Only navigate if it's not from inspector, or is from inspector but we're not in full-width mode.
				const navigate = !body.fromInspector || this.devTools.getDevToolsLocation(widgetInspectorPage.id) !== "active";
				if (navigate)
					void vs.commands.executeCommand("_dart.jumpToLineColInUri", vs.Uri.parse(body.file as string), body.line, body.column, body.inOtherEditorColumn);
				if (this.isInspectingWidget && this.autoCancelNextInspectWidgetMode) {
					// Add a short delay because this will remove the visible selection.
					setTimeout(() => vs.commands.executeCommand("flutter.cancelInspectWidget"), 1000);
				}
			}
		} else {
			// Not handled, will fall through in the caller.
			return false;
		}
		return true;
	}

	private async handleCustomEventWithSession(session: DartDebugSessionInformation, e: vs.DebugSessionCustomEvent) {
		this.vmServices.handleDebugEvent(session, e)
			.catch((e) => this.logger.error(e));

		const event = e.event;
		const body = e.body;

		if (event === "dart.webLaunchUrl") {
			const launched = !!body.launched;
			if (!launched && !session.session.configuration.suppressWebServerDeviceBrowserLaunch) {
				try {
					await envUtils.openInBrowser(body.url as string, this.logger);
				} catch (e: any) {
					this.logger.error(`Failed to launch URL from Flutter app.webLaunchUrl event: ${body.url}`);
				}
			}
		} else if (event === "dart.exposeUrl") {
			const originalUrl = body.url as string;
			try {
				const exposedUrl = await envUtils.exposeUrl(originalUrl, this.logger);
				await session.session.customRequest("exposeUrlResponse", { originalUrl, exposedUrl });
			} catch (e) {
				this.logger.error(`Failed to expose URL ${originalUrl}: ${e}`);
				await session.session.customRequest("exposeUrlResponse", { originalUrl, exposedUrl: originalUrl });
			}
		} else if (event === "flutter.forwardedEvent") {
			const event = body.event;
			const params = body.params;
			switch (event) {
				case "app.webLaunchUrl":
					const url = params.url as string;
					const launched = !!params.launched;
					if (!launched && !session.session.configuration.suppressWebServerDeviceBrowserLaunch) {
						try {
							await envUtils.openInBrowser(url, this.logger);
						} catch (e: any) {
							this.logger.error(`Failed to launch URL from Flutter app.webLaunchUrl event: ${url}`);
						}
					}
			}
		} else if (event === "flutter.forwardedRequest") {
			const id = body.id;
			const method = body.method;
			const params = body.params;
			let result;
			let error;
			try {
				switch (method) {
					case "app.exposeUrl":
						const originalUrl = params.url as string;
						let url;
						try {
							url = await envUtils.exposeUrl(originalUrl, this.logger);
						} catch (e) {
							this.logger.error(`Failed to expose URL ${originalUrl}: ${e}`);
							url = originalUrl;
						}
						result = { url };
						break;
				}
			} catch (e) {
				error = `${e}`;
			}
			void session.session.customRequest("flutter.sendForwardedRequestResponse", { id, result, error });
		} else if (event === "dart.debuggerUris") {
			session.observatoryUri = body.observatoryUri;
			session.vmServiceUri = body.vmServiceUri;
			session.clientVmServiceUri = body.clientVmServiceUri;
			this.onDebugSessionVmServiceAvailableEmitter.fire(session);
			debugSessionsChangedEmitter.fire();

			// Open or prompt for DevTools when appropriate.
			const debuggerType: DebuggerType = session.session.configuration.debuggerType;
			if (debuggerType === DebuggerType.Dart || debuggerType === DebuggerType.Flutter || debuggerType === DebuggerType.Web) {
				if (session.session.configuration.openDevTools) {
					const pageId = session.session.configuration.openDevTools;
					if (pageId) {
						void vs.commands.executeCommand("dart.openDevTools", { debugSessionId: session.session.id, triggeredAutomatically: true, pageId, commandSource: CommandSource.launchConfiguration });
					} else {
						void vs.window.showWarningMessage(`Debug configuration contain an invalid DevTools page '${pageId}' in 'openDevTools'`);
					}
				} else if (config.openDevTools !== "never") {
					const shouldLaunch = debuggerType !== DebuggerType.Dart || config.openDevTools === "always";
					if (shouldLaunch) {
						// If embedded DevTools is enabled and it's a Flutter app, assume the user wants the Widget inspector.
						// Otherwise, DevTools will be launched externally (since it's not clear which page they may want).
						const page = debuggerType === DebuggerType.Flutter ? widgetInspectorPage : null;
						const location = page ? undefined : "external";
						void vs.commands.executeCommand("dart.openDevTools", { debugSessionId: session.session.id, triggeredAutomatically: true, pageId: page?.id, location, commandSource: CommandSource.onDebugAutomatic });
					}
				} else if (debuggerType === DebuggerType.Flutter) {
					void showDevToolsNotificationIfAppropriate(this.context).then((res) => {
						if (res.shouldAlwaysOpen)
							void config.setOpenDevTools("flutter");
					});
				}
			}
		} else if (event === "dart.progressStart") {
			// When a debug session is restarted by VS Code (eg. not handled by the DA), the session-end event
			// will not fire so we need to clean up the "Terminating debug session" message manually. Doing it here
			// means it will vanish at the same time as the new one appears, so there are no gaps in progress indicators.
			if (body.progressId === debugLaunchProgressId) {
				session.progress[debugTerminatingProgressId]?.complete();
				delete session.progress[debugTerminatingProgressId];
			}

			const progressId = body.progressId as string | undefined;
			const isHotEvent = progressId?.includes("reload") || progressId?.includes("restart");
			const progressLocation = isHotEvent && config.hotReloadProgress === "statusBar" ? vs.ProgressLocation.Window : vs.ProgressLocation.Notification;

			await vs.window.withProgress(
				// TODO: This was previously Window to match what we'd get using DAP progress
				// notifications but users prefer larger notifications as they're easier to
				// see (especially when it comes to things like waiting for debug extension).
				// https://github.com/Dart-Code/Dart-Code/issues/2597
				// If this is changed back, ensure the waiting-for-debug-extension notification
				// is still displayed with additional description.
				{ location: progressLocation, title: body.title },
				(progress) => {
					// Complete any existing one with this ID.
					session.progress[body.progressId]?.complete();

					// Build a new progress and store it in the session.
					const completer = new PromiseCompleter<void>();
					session.progress[body.progressId] = new ProgressMessage(progress, completer);
					if (body.message)
						session.progress[body.progressId]?.report(body.message as string);
					return completer.promise;
				},
			);
		} else if (event === "dart.progressUpdate") {
			session.progress[body.progressId]?.report(body.message as string);
		} else if (event === "dart.progressEnd") {
			if (body.message) {
				session.progress[body.progressId]?.report(body.message as string);
				await new Promise((resolve) => setTimeout(resolve, 400));
			}
			session.progress[body.progressId]?.complete();
		} else if (event === "dart.flutter.widgetErrorInspectData") {
			if (this.suppressFlutterWidgetErrors || !config.showInspectorNotificationsForWidgetErrors)
				return;

			const data = e.body as WidgetErrorInspectData;
			if (data.devToolsUrl !== (await this.devTools.devtoolsUrl))
				return;

			// To avoid spam, when we show this dialog we will set a flag that prevents any more
			// of these types of dialogs until it is dismissed or 5 seconds have passed.
			this.suppressFlutterWidgetErrors = true;
			const timer = setTimeout(() => this.suppressFlutterWidgetErrors = false, 5000);

			const inspectAction = `Inspect Widget`;
			const choice = await vs.window.showWarningMessage(data.errorDescription, inspectAction, doNotAskAgainAction);
			if (choice === inspectAction && session.vmServiceUri) {
				void this.devTools.spawn(
					session as DartDebugSessionInformation & { vmServiceUri: string },
					{
						inspectorRef: data.inspectorReference,
						pageId: widgetInspectorPage.id,
					},
				);
			} else if (choice === doNotAskAgainAction) {
				void config.setShowInspectorNotificationsForWidgetErrors(false);
			}
			clearTimeout(timer);
			this.suppressFlutterWidgetErrors = false;
		} else if (event === "flutter.appStarted") {
			session.hasStarted = true;
			debugSessionsChangedEmitter.fire();
			// In noDebug mode, we won't see services registered but we can tell if Hot Reload
			// is available.
			if (session.supportsHotReload)
				this.vmServices.handleServiceRegistered(VmService.HotReload, VmService.HotReload);
		} else if (event === "flutter.appStart") {
			session.flutterMode = body?.mode;
			session.flutterDeviceId = body?.deviceId;
			session.supportsHotReload = body?.supportsRestart;
			debugSessionsChangedEmitter.fire();
		}
	}

	private toggleDebugOptions() {
		// -1 is because we skip the last combination when toggling since it seems uncommon.
		this.currentDebugOption = (this.currentDebugOption + 1) % (debugOptionNames.length - 1);
		this.applyNewDebugOption();
	}

	private applyNewDebugOption() {
		this.debugOptions.text = `Debug ${debugOptionNames[this.currentDebugOption]}`;

		const debugExternalPackageLibraries = this.currentDebugOption === DebugOption.MyCodePackages || this.currentDebugOption === DebugOption.MyCodePackagesSdk;
		const debugSdkLibraries = this.currentDebugOption === DebugOption.MyCodeSdk || this.currentDebugOption === DebugOption.MyCodePackagesSdk;

		void config.setGlobalDebugExternalPackageLibraries(debugExternalPackageLibraries);
		void config.setGlobalDebugSdkLibraries(debugSdkLibraries);

		debugSessions.forEach((session) => {
			void session.session.customRequest("updateDebugOptions", {
				debugExternalPackageLibraries,
				debugSdkLibraries,
			});
		});
	}

	private updateRunnableContexts(): void {
		const editor = vs.window.activeTextEditor;
		const documentUri = editor?.document.uri;
		if (!documentUri || documentUri.scheme !== "file")
			return;

		const documentPath = fsPath(documentUri);
		// Try simple check first to avoid possible out-of-sync outline.
		let isRunnable = isValidEntryFile(documentPath);

		if (!isRunnable) {
			const outline = this.fileTracker?.getOutlineFor(documentPath);
			isRunnable = !!outline?.children?.find((c) => c.element.name === "main");
		}

		void vs.commands.executeCommand("setContext", CURRENT_FILE_RUNNABLE, isRunnable);
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
