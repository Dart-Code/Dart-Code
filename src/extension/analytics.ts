import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import { debug, DebugAdapterTracker, DebugAdapterTrackerFactory, env, TelemetryLogger, TelemetrySender } from "vscode";
import { dartCodeExtensionIdentifier, ExtensionRestartReason, isChromeOS, isDartCodeTestRun, isWin, isWSL } from "../shared/constants";
import { IAmDisposable, Logger } from "../shared/interfaces";
import { disposeAll } from "../shared/utils";
import { getRandomInt } from "../shared/utils/fs";
import { simplifyVersion } from "../shared/utils/workspace";
import { hasFlutterExtension, isDevExtension, isPreReleaseExtension } from "../shared/vscode/extension_utils";
import { hostKind } from "../shared/vscode/utils";
import { WorkspaceContext } from "../shared/workspace";
import { config } from "./config";

// Set to true for analytics to be sent to the debug endpoint (non-logging) for validation.
// This is only required for debugging analytics and needn't be sent for standard Dart Code development (dev hits are already filtered with isDevelopment).
const debugMode = false;

/// Analytics require that we send a value for uid or cid, but when running in the VS Code
// dev host we don't have either.
const sendAnalyticsFromExtensionDevHost = false;

// Machine ID is not set for extension dev host unless the boolean above is set to true (which
// is usually done for testing purposes).
const machineId = env.machineId !== "someValue.machineId"
	? env.machineId
	: (sendAnalyticsFromExtensionDevHost ? "35009a79-1a05-49d7-dede-dededededede" : undefined);

const sessionId = getRandomInt(0x1000, 0x100000).toString(16);
const sessionStartMs = new Date().getTime();

export enum AnalyticsEvent {
	Extension_Activated,
	Extension_Restart,
	Extension_Deactivate,
	SdkDetectionFailure,
	AnalysisServer_Terminate,
	Debugger_Activated,
	DevTools_Opened,
	FlutterSurvey_Shown,
	FlutterSurvey_Clicked,
	FlutterSurvey_Dismissed,
	FlutterOutline_Activated,
	Command_AddSdkToPath,
	ExtensionRecommendation_Shown,
	ExtensionRecommendation_Accepted,
	ExtensionRecommendation_Rejected,
	Command_CloneSdk,
	Command_DartNewProject,
	Command_FlutterNewProject,
	Command_FlutterDoctor,
	Command_AddDependency,
	Command_RestartAnalyzer,
	Command_ForceReanalyze,
	Error_FlutterDaemonTimeout,
}

class GoogleAnalyticsTelemetrySender implements TelemetrySender {
	constructor(readonly logger: Logger, readonly handleError: (e: unknown) => void) { }

	sendEventData(eventName: string, data?: Record<string, any>): void {
		if (!data) return;
		this.send(data as AnalyticsData).catch((e) => this.handleError(e));
	}

	sendErrorData(): void {
		// No errors are collected.
	}

	private async send(data: AnalyticsData): Promise<void> {
		const analyticsData = {
			// Everything listed here should be in the 'telemetry.json' file in the extension root.
			client_id: machineId, // eslint-disable-line camelcase
			events: [{
				name: data.event,
				params: {
					addSdkToPathResult: data.addSdkToPathResult,
					cloneSdkResult: data.cloneSdkResult,
					commandSource: data.commandSource,
					data: data.data,
					debuggerAdapterType: data.debuggerAdapterType,
					debuggerExceptionBreakMode: data.debuggerExceptionBreakMode,
					debuggerPreference: data.debuggerPreference,
					debuggerRunType: data.debuggerRunType,
					debuggerType: data.debuggerType,
					exitCode: data.exitCode,
					reason: data.reason,
					sessionDurationSeconds: data.sessionDurationSeconds,
					totalSessionDurationSeconds: data.totalSessionDurationSeconds,
					// GA4 doesn't record any users unless there is non-zero engagement time.
					// eslint-disable-next-line camelcase
					engagement_time_msec: new Date().getTime() - sessionStartMs,
					// eslint-disable-next-line camelcase
					session_id: sessionId,
				},
			}],
			user_properties: this.buildUserProperties(data), // eslint-disable-line camelcase
		};

		if (debugMode)
			this.logger.info("Sending analytic: " + JSON.stringify(analyticsData));

		const options: https.RequestOptions = {
			headers: {
				"Content-Type": "application/json",
			},
			hostname: "www.google-analytics.com",
			method: "POST",
			path: (debugMode ? "/debug/mp/collect" : "/mp/collect")
				// Not really secret, is it...
				+ "?api_secret=Y7bcxwkTQ-ekVL0ys4htBA&measurement_id=G-WXNLFN7DDJ",
			port: 443,
		};

		await new Promise<void>((resolve, reject) => {
			const req = https.request(options, (resp) => {
				if (debugMode) {
					const chunks: string[] = [];
					resp.on("data", (b: Buffer | string) => chunks.push(b.toString()));
					resp.on("end", () => {
						const json = chunks.join("");
						try {
							const gaDebugResp = JSON.parse(json);
							if (gaDebugResp?.hitParsingResult && gaDebugResp.hitParsingResult[0].valid === true)
								this.logger.info("Sent OK!");
							else if (gaDebugResp?.hitParsingResult && gaDebugResp.hitParsingResult[0].valid === false)
								this.logger.warn(json);
							else
								this.logger.warn(`Unexpected GA debug response: ${json}`);
						} catch (e: any) {
							this.logger.warn(`Error in GA debug response: ${e?.message ?? e} ${json}`);
						}
					});
				}

				if (!resp?.statusCode || resp.statusCode < 200 || resp.statusCode > 300) {
					this.logger.info(`Failed to send analytics ${resp?.statusCode}: ${resp?.statusMessage}`);
				}
				resolve();
			});
			req.write(JSON.stringify(analyticsData));
			req.on("error", (e) => {
				reject(e);
			});
			req.end();
		});
	}

	private buildUserProperties(data: AnalyticsData) {
		const dataMap = data as Record<string, any>;
		const userProperties: Record<string, any> = {};

		function add(name: string, value: any) {
			if (value)
				userProperties[name] = { value };
		}

		add("analyzerProtocol", data.analyzerProtocol);
		add("appName", data.appName ?? "Unknown");
		add("closingLabels", data.closingLabels);

		add("appVersionRaw", dataMap["common.extversion"]);
		add("appVersion", simplifyVersion(dataMap["common.extversion"]));
		add("codeVersionRaw", dataMap["common.vscodeversion"]);
		add("codeVersion", simplifyVersion(dataMap["common.vscodeversion"]));
		add("dartVersionRaw", data.dartVersion);
		add("dartVersion", simplifyVersion(data.dartVersion));
		add("flutterVersionRaw", data.flutterVersion);
		add("flutterVersion", simplifyVersion(data.flutterVersion));

		add("extensionName", dataMap["common.extname"]);
		add("flutterExtension", data.flutterExtension);
		add("flutterHotReloadOnSave", data.flutterHotReloadOnSave);
		add("flutterUiGuides", data.flutterUiGuides);
		add("formatter", data.formatter);
		add("extensionKind", data.extensionKind);
		add("platform", data.platform);
		add("hostKind", data.hostKind ?? "desktop");
		// GA Max is 24 chars
		add("onlyAnalyzeProjectsWithO", data.onlyAnalyzeProjectsWithOpenFiles);
		add("showTodos", data.showTodos);
		add("userLanguage", data.language);
		add("workspaceType", data.workspaceType);

		return userProperties;
	}
}

export class Analytics implements IAmDisposable {
	private readonly disposables: IAmDisposable[] = [];

	public sdkVersion?: string;
	public flutterSdkVersion?: string | undefined;
	private readonly formatter: string;

	// If analytics fail or we see an opt-out for Dart/Flutter, disable for the rest of this session.
	private disableAnalyticsForSession = false;

	// Some things we only want to log the first use per session to get an idea of
	// number of sessions using.
	private hasLoggedFlutterOutline = false;

	private telemetryLogger: TelemetryLogger | undefined;
	private readonly exceptionBreakTrackerFactory: DebugAdapterExceptionSettingTrackerFactory;

	public workspaceContext: WorkspaceContext | undefined;

	constructor(private readonly logger: Logger) {
		this.formatter = this.getFormatterSetting();
		this.exceptionBreakTrackerFactory = new DebugAdapterExceptionSettingTrackerFactory();
		this.disposables.push(debug.registerDebugAdapterTrackerFactory("dart", this.exceptionBreakTrackerFactory));

		// If the API isn't supported (Theia) then we'll just not set anything up.
		if (!env.createTelemetryLogger) {
			this.logger.info(`createTelemetryLogger is unsupported`);
			return;
		}

		// Similarly, if the user has opted out of Dart/Flutter's telemetry, we should assume they might
		// (reasonably) expect that covers this extension, so don't set anything up in that case either.
		if (this.isOptedOutOfDartToolingTelemetry())
			return;

		if (!env.isTelemetryEnabled) {
			this.logger.info(`VS Code telemetry is disabled, analytics events will not be sent unless re-enabled`);
			// Don't return, as we check this on each event.
		}

		const googleAnalyticsTelemetrySender = new GoogleAnalyticsTelemetrySender(logger, (e) => this.handleError(e));
		this.telemetryLogger = env.createTelemetryLogger(googleAnalyticsTelemetrySender);
	}

	/// If a user opts-out of Dart/Flutter telemetry with the command line apps, also opt-out here to avoid
	/// confusion between Dart/Flutter analytics being reported to Google and extension analytics going
	/// to Dart Code. The prompt from the analysis server mentions "VS Code IDE plugins" which suggests the
	/// mechanism for opting out would apply to Dart Code.
	private isOptedOutOfDartToolingTelemetry(): boolean {
		// Don't let this function ever throw.
		try {
			const configDirectory = isWin ? process.env.USERPROFILE : process.env.HOME;
			if (!configDirectory) {
				this.logger.warn(`No valid home dir to check Dart/Flutter analytics file, disabling analytics`);
				return true;
			}

			const configFile = path.join(configDirectory, ".dart-tool", "dart-flutter-telemetry.config");
			if (!fs.existsSync(configFile)) {
				return false; // No file, means not opted out.
			}
			const configFileContents = fs.readFileSync(configFile).toString();
			const optedOutRegex = /^reporting=0/m;
			if (optedOutRegex.test(configFileContents)) {
				this.logger.info(`Dart/Flutter tooling telemetry is opted-out, disabling for Dart Code`);
				return true;
			}
			return false;
		} catch (e) {
			this.logger.warn(`Failed to check Dart/Flutter analytics file, disabling analytics: ${e}`);
			return true;
		}
	}

	private event(category: AnalyticsEvent, customData?: Partial<AnalyticsData>): void {
		if (this.disableAnalyticsForSession
			|| !this.telemetryLogger
			|| !machineId
			|| !config.allowAnalytics /* Kept for users that opted-out when we used own flag */
			|| this.workspaceContext?.config.disableAnalytics
			|| !env.isTelemetryEnabled
			|| isDartCodeTestRun
		)
			return;

		const flutterUiGuides = this.workspaceContext?.hasAnyFlutterProjects
			? (config.previewFlutterUiGuides ? (config.previewFlutterUiGuidesCustomTracking ? "On + Custom Tracking" : "On") : "Off")
			: undefined;

		const platformSuffix = isChromeOS
			? " (ChromeOS)"
			: isWSL
				? " (WSL)"
				: "";
		const data: AnalyticsData = {
			analyzerProtocol: "LSP",
			anonymize: true,
			appName: env.appName,
			closingLabels: config.closingLabels ? "On" : "Off",
			dartVersion: this.sdkVersion,
			event: AnalyticsEvent[category],
			extensionKind: isDevExtension ? "Dev" : isPreReleaseExtension ? "Pre-Release" : "Stable",
			flutterExtension: hasFlutterExtension ? "Installed" : "Not Installed",
			flutterHotReloadOnSave: this.workspaceContext?.hasAnyFlutterProjects ? config.flutterHotReloadOnSave : undefined,
			flutterUiGuides,
			flutterVersion: this.flutterSdkVersion,
			formatter: this.formatter,
			hostKind,
			language: env.language,
			platform: `${process.platform}${platformSuffix}`,
			onlyAnalyzeProjectsWithOpenFiles: config.onlyAnalyzeProjectsWithOpenFiles ? "On" : "Off",
			showTodos: config.showTodos ? "On" : "Off",
			workspaceType: this.workspaceContext?.workspaceTypeDescription,
			...customData,
		};

		this.telemetryLogger.logUsage("event", data);
	}

	private getFormatterSetting(): string {
		try {
			// If there are multiple formatters for Dart, the user can select one, so check
			// that first so we don't record their formatter being enabled as ours.
			const otherDefaultFormatter = config.resolved.getAppliedConfig<string | undefined>("editor", "defaultFormatter", false);
			if (otherDefaultFormatter && otherDefaultFormatter !== dartCodeExtensionIdentifier)
				return otherDefaultFormatter;

			// If the user has explicitly disabled ours (without having another selected
			// then record that).
			if (!config.enableSdkFormatter)
				return "Disabled";

			// Otherwise record as enabled (and whether on-save).
			return config.resolved.getAppliedConfig("editor", "formatOnSave")
				? "Enabled on Save"
				: "Enabled";
		} catch {
			return "Unknown";
		}
	}

	private handleError(e: unknown) {
		this.disableAnalyticsForSession = true;
		this.logger.info(`Failed to send analytics, disabling for session: ${e}`);
	}

	private getDebuggerPreference(): string {
		if (config.debugSdkLibraries && config.debugExternalPackageLibraries)
			return "All code";
		else if (config.debugSdkLibraries)
			return "My code + SDK";
		else if (config.debugExternalPackageLibraries)
			return "My code + Packages";
		else
			return "My code";
	}

	// All events below should be included in telemetry.json.
	public logExtensionActivated() { this.event(AnalyticsEvent.Extension_Activated); }
	public logExtensionRestart(reason: ExtensionRestartReason) {
		const customData: Partial<AnalyticsData> = {
			reason,
		};
		this.event(AnalyticsEvent.Extension_Restart, customData);
	}
	public logExtensionDeactivate({ sessionDurationMs, totalSessionDurationMs, reason }: { sessionDurationMs: number | undefined; totalSessionDurationMs: number | undefined; reason?: ExtensionRestartReason }) {
		const customData: Partial<AnalyticsData> = {
			sessionDurationSeconds: sessionDurationMs ? sessionDurationMs / 1000 : undefined,
			totalSessionDurationSeconds: totalSessionDurationMs ? totalSessionDurationMs / 1000 : undefined,
			reason,
		};
		this.event(AnalyticsEvent.Extension_Deactivate, customData);
	}

	public logAnalysisServerTerminate(exitCode: number, sessionDurationMs: number) {
		const customData: Partial<AnalyticsData> = {
			sessionDurationSeconds: sessionDurationMs / 1000,
			exitCode,
		};
		this.event(AnalyticsEvent.AnalysisServer_Terminate, customData);
	}

	public logErrorFlutterDaemonTimeout() { this.event(AnalyticsEvent.Error_FlutterDaemonTimeout); }
	public logSdkDetectionFailure() { this.event(AnalyticsEvent.SdkDetectionFailure); }
	public logDebuggerStart(debuggerType: string, debuggerRunType: string, sdkDap: boolean) {
		const customData: Partial<AnalyticsData> = {
			debuggerAdapterType: sdkDap ? "SDK" : "Legacy",
			debuggerExceptionBreakMode: debuggerRunType === "Debug" ? this.exceptionBreakTrackerFactory.lastTracker?.lastExceptionOptions : undefined,
			debuggerPreference: this.getDebuggerPreference(),
			debuggerRunType,
			debuggerType,
		};
		this.event(AnalyticsEvent.Debugger_Activated, customData);
	}
	public logAddSdkToPath(result: AddSdkToPathResult) {
		const customData: Partial<AnalyticsData> = {
			addSdkToPathResult: AddSdkToPathResult[result],
		};
		this.event(AnalyticsEvent.Command_AddSdkToPath, customData);
	}
	public logGitCloneSdk(result: CloneSdkResult) {
		const customData: Partial<AnalyticsData> = {
			cloneSdkResult: CloneSdkResult[result],
		};
		this.event(AnalyticsEvent.Command_CloneSdk, customData);
	}
	public logExtensionPromotion(
		kind: AnalyticsEvent.ExtensionRecommendation_Shown | AnalyticsEvent.ExtensionRecommendation_Accepted | AnalyticsEvent.ExtensionRecommendation_Rejected,
		extension: string,
	) {
		const customData: Partial<AnalyticsData> = {
			data: extension,
		};
		this.event(kind, customData);
	}
	public logDevToolsOpened(commandSource: string | undefined) { this.event(AnalyticsEvent.DevTools_Opened, { commandSource }); }
	public logFlutterDoctor(commandSource: string | undefined) { this.event(AnalyticsEvent.Command_FlutterDoctor, { commandSource }); }
	public logFlutterNewProject(commandSource: string | undefined) { this.event(AnalyticsEvent.Command_FlutterNewProject, { commandSource }); }
	public logDartNewProject(commandSource: string | undefined) { this.event(AnalyticsEvent.Command_DartNewProject, { commandSource }); }
	public logFlutterSurveyShown() { this.event(AnalyticsEvent.FlutterSurvey_Shown); }
	public logFlutterSurveyClicked() { this.event(AnalyticsEvent.FlutterSurvey_Clicked); }
	public logFlutterSurveyDismissed() { this.event(AnalyticsEvent.FlutterSurvey_Dismissed); }
	public logFlutterOutlineActivated() {
		if (this.hasLoggedFlutterOutline)
			return;
		this.hasLoggedFlutterOutline = true;
		this.event(AnalyticsEvent.FlutterOutline_Activated);
	}
	public log(category: AnalyticsEvent) { this.event(category); }

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

interface AnalyticsData {
	anonymize: true,
	event: string,
	language: string,

	extensionKind: string,
	platform: string,
	appName: string | undefined,
	hostKind: string | undefined,
	workspaceType: string | undefined,
	dartVersion: string | undefined,
	flutterVersion: string | undefined,
	flutterExtension: string,

	analyzerProtocol: string,
	formatter: string,
	onlyAnalyzeProjectsWithOpenFiles: string,
	showTodos: string,
	closingLabels: string,
	flutterUiGuides: string | undefined,
	flutterHotReloadOnSave: string | undefined,

	// Generic reason (for things like extension restart).
	reason?: string,

	// For debugger start events.
	// TODO(dantup): Should these be params on the event, rather than user properties?
	debuggerType?: string,
	debuggerRunType?: string,
	debuggerAdapterType?: string,
	debuggerPreference?: string,
	debuggerExceptionBreakMode?: string,

	// For "Add SDK to PATH" command.
	addSdkToPathResult?: string,

	// For "Download SDK" git-clone flow.
	cloneSdkResult?: string,

	// Generic string data for an event, such as extension ID of promoted extension.
	data?: string,

	// Source of commands, such as launching from sidebar vs command palette.
	commandSource?: string,

	// Extension + service lifecycle timings.
	exitCode?: number,
	sessionDurationSeconds?: number,
	totalSessionDurationSeconds?: number,
}

class DebugAdapterExceptionSettingTrackerFactory implements DebugAdapterTrackerFactory {
	public lastTracker: DebugAdapterExceptionSettingTracker | undefined;
	createDebugAdapterTracker(): DebugAdapterTracker {
		this.lastTracker = new DebugAdapterExceptionSettingTracker();
		return this.lastTracker;
	}
}

class DebugAdapterExceptionSettingTracker implements DebugAdapterTracker {
	public lastExceptionOptions: string | undefined;
	onWillReceiveMessage(message: any): void {
		if (message.command === "setExceptionBreakpoints") {
			const exceptionFilters = message.arguments?.filters ?? [];
			this.lastExceptionOptions = exceptionFilters.slice().sort().join(", ");
			if (!this.lastExceptionOptions)
				this.lastExceptionOptions = "None";
		}
	}
}

export enum AddSdkToPathResult {
	alreadyExisted,
	succeeded,
	failed,
	unavailableOnPlatform,
}

export enum CloneSdkResult {
	cancelled,
	noGit,
	succeeded,
	failed,
}
