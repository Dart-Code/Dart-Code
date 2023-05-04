import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import * as querystring from "querystring";
import { env, TelemetryLogger, TelemetrySender, Uri, workspace } from "vscode";
import { dartCodeExtensionIdentifier, isChromeOS, isDartCodeTestRun, isWin } from "../shared/constants";
import { Logger } from "../shared/interfaces";
import { hasFlutterExtension, isDevExtension } from "../shared/vscode/extension_utils";
import { WorkspaceContext } from "../shared/workspace";
import { config } from "./config";

// Set to true for analytics to be sent to the debug endpoint (non-logging) for validation.
// This is only required for debugging analytics and needn't be sent for standard Dart Code development (dev hits are already filtered with isDevelopment).
const debug = false;

/// Analytics require that we send a value for uid or cid, but when running in the VS Code
// dev host we don't have either.
const sendAnalyticsFromExtensionDevHost = false;

// Machine ID is not set for extension dev host unless the boolean above is set to true (which
// is usually done for testing purposes).
const machineId = env.machineId !== "someValue.machineId"
	? env.machineId
	: (sendAnalyticsFromExtensionDevHost ? "35009a79-1a05-49d7-dede-dededededede" : undefined);

enum Category {
	Extension,
	Analyzer,
	Debugger,
	FlutterSurvey,
	FlutterOutline,
	Command,
}

enum EventAction {
	Activated,
	SdkDetectionFailure,
	Deactivated,
	Restart,
	HotReload,
	OpenObservatory,
	OpenTimeline,
	OpenDevTools,
	Shown,
	Clicked,
	Dismissed,
}

export enum EventCommand {
	DartNewProject,
	FlutterNewProject,
	AddDependency,
	RestartAnalyzer,
}

class GoogleAnalyticsTelemetrySender implements TelemetrySender {
	constructor(readonly logger: Logger, readonly handleError: (e: unknown) => void) { }

	sendEventData(eventName: string, data?: Record<string, any> | undefined): void {
		if (!data) return;
		this.send(data as AnalyticsData).catch((e) => this.handleError(e));
	}

	sendErrorData(error: Error, data?: Record<string, any> | undefined): void {
		// No errors are collected.
	}

	private async send(data: AnalyticsData & Record<string, any>): Promise<void> {
		const analyticsData = {
			// Everything listed here should be in the 'telemetry.json' file in the extension root.
			aip: data.anonymize ? 1 : null,
			an: data["common.extname"],
			av: data["common.extversion"],
			cd1: data.isDevExtension,
			cd10: data.showTodos,
			cd11: data.analyzerProtocol,
			cd12: data.formatter,
			cd13: data.flutterVersion,
			cd14: data.flutterExtension,
			cd15: data.debuggerType,
			cd16: data.debuggerRunType,
			cd17: data.flutterUiGuides,
			cd18: data.debuggerAdapterType,
			cd19: data["common.remotename"],
			cd2: data.platform,
			cd20: data.appName ?? "Unknown",
			cd3: data.dartVersion,
			cd5: data["common.vscodeversion"],
			cd6: data.debuggerPreference,
			cd7: data.workspaceType,
			cd8: data.closingLabels,
			cd9: data.flutterHotReloadOnSave,
			cid: machineId,
			ea: data.eventAction,
			ec: data.eventCategory,
			sc: data.sessionControl,
			t: "event",
			tid: "UA-2201586-19",
			ul: data.language,
			v: "1", // API Version.
		};

		if (debug)
			this.logger.info("Sending analytic: " + JSON.stringify(analyticsData));

		const options: https.RequestOptions = {
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			hostname: "www.google-analytics.com",
			method: "POST",
			path: debug ? "/debug/collect" : "/collect",
			port: 443,
		};

		await new Promise<void>((resolve, reject) => {
			const req = https.request(options, (resp) => {
				if (debug) {
					const chunks: string[] = [];
					resp.on("data", (b: Buffer | string) => chunks.push(b.toString()));
					resp.on("end", () => {
						const json = chunks.join("");
						try {
							const gaDebugResp = JSON.parse(json);
							if (gaDebugResp && gaDebugResp.hitParsingResult && gaDebugResp.hitParsingResult[0].valid === true)
								this.logger.info("Sent OK!");
							else if (gaDebugResp && gaDebugResp.hitParsingResult && gaDebugResp.hitParsingResult[0].valid === false)
								this.logger.warn(json);
							else
								this.logger.warn(`Unexpected GA debug response: ${json}`);
						} catch (e: any) {
							this.logger.warn(`Error in GA debug response: ${e?.message ?? e} ${json}`);
						}
					});
				}

				if (!resp || !resp.statusCode || resp.statusCode < 200 || resp.statusCode > 300) {
					this.logger.info(`Failed to send analytics ${resp && resp.statusCode}: ${resp && resp.statusMessage}`);
				}
				resolve();
			});
			req.write(querystring.stringify(analyticsData));
			req.on("error", (e) => {
				reject(e);
			});
			req.end();
		});
	}
}

export class Analytics {
	public sdkVersion?: string;
	public flutterSdkVersion?: string | undefined;
	private readonly formatter: string;
	private readonly dummyDartFile = Uri.parse("untitled:foo.dart");
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
	private readonly dartConfig = workspace.getConfiguration("", this.dummyDartFile).get("[dart]") as any;

	// If analytics fail or we see an opt-out for Dart/Flutter, disable for the rest of this session.
	private disableAnalyticsForSession = false;

	// Some things we only want to log the first use per session to get an idea of
	// number of sessions using.
	private hasLoggedFlutterOutline = false;

	private telemetryLogger: TelemetryLogger | undefined;

	constructor(private readonly logger: Logger, readonly workspaceContext: WorkspaceContext) {
		this.formatter = this.getFormatterSetting();

		// If the API isn't supported (Theia) then we'll just not set anything up.
		if (!env.createTelemetryLogger)
			return;

		// Similarly, if the user has opted out of Dart/Flutter's telemetry, we should assume they might
		// (reasonably) expect that covers this extension, so don't set anything up in that case either.
		if (this.isOptedOutOfDartToolingTelemetry())
			return;

		const googleAnalyticsTelemetrySender = new GoogleAnalyticsTelemetrySender(logger, (e) => this.handleError(e));
		this.telemetryLogger = env.createTelemetryLogger(googleAnalyticsTelemetrySender);
	}

	/// If a user opts-out of Dart/Flutter telemetry with the command line apps, also opt-out here to avoid
	/// confusion between Dart/Flutter analytics being reported to Google and extension analytics going
	/// to Dart-Code. The prompt from the analysis server mentions "VS Code IDE plugins" which suggests the
	/// mechanism for opting out would apply to Dart-Code.
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
				this.logger.info(`Dart/Flutter tooling telemetry is opted-out, disabling for Dart-Code`);
				return true;
			}
			return false;
		} catch (e) {
			this.logger.warn(`Failed to check Dart/Flutter analytics file, disabling analytics: ${e}`);
			return true;
		}
	}

	private event(category: Category, action: EventAction | string, customData?: Partial<AnalyticsData>): void {
		if (this.disableAnalyticsForSession
			|| !this.telemetryLogger
			|| !machineId
			|| !config.allowAnalytics /* Kept for users that opted-out when we used own flag */
			|| this.workspaceContext.config.disableAnalytics
			|| !env.isTelemetryEnabled
			|| isDartCodeTestRun
		)
			return;

		const flutterUiGuides = this.workspaceContext.hasAnyFlutterProjects
			? (config.previewFlutterUiGuides ? (config.previewFlutterUiGuidesCustomTracking ? "On + Custom Tracking" : "On") : "Off")
			: undefined;

		const data: AnalyticsData = {
			analyzerProtocol: this.workspaceContext.config.useLegacyProtocol ? "DAS" : "LSP",
			anonymize: true,
			appName: env.appName,
			closingLabels: config.closingLabels ? "On" : "Off",
			dartVersion: this.sdkVersion,
			eventAction: typeof action === "string" ? action : EventAction[action],
			eventCategory: Category[category],
			flutterExtension: hasFlutterExtension ? "Installed" : "Not Installed",
			flutterHotReloadOnSave: this.workspaceContext.hasAnyFlutterProjects ? config.flutterHotReloadOnSave : undefined,
			flutterUiGuides,
			flutterVersion: this.flutterSdkVersion,
			formatter: this.formatter,
			isDevExtension,
			language: env.language,
			platform: isChromeOS ? `${process.platform} (ChromeOS)` : process.platform,
			showTodos: config.showTodos ? "On" : "Off",
			workspaceType: this.workspaceContext.workspaceTypeDescription,
			...customData,
		};

		// Force a session start if this is extension activation.
		if (category === Category.Extension && action === EventAction.Activated)
			data.sessionControl = "start";

		// Force a session end if this is extension deactivation.
		if (category === Category.Extension && action === EventAction.Deactivated)
			data.sessionControl = "end";

		this.telemetryLogger.logUsage("event", data);
	}

	private getFormatterSetting(): string {
		try {
			// If there are multiple formatters for Dart, the user can select one, so check
			// that first so we don't record their formatter being enabled as ours.
			const otherDefaultFormatter = this.getAppliedConfig("editor", "defaultFormatter", false);
			if (otherDefaultFormatter && otherDefaultFormatter !== dartCodeExtensionIdentifier)
				return otherDefaultFormatter;

			// If the user has explicitly disabled ours (without having another selected
			// then record that).
			if (!config.enableSdkFormatter)
				return "Disabled";

			// Otherwise record as enabled (and whether on-save).
			return this.getAppliedConfig("editor", "formatOnSave")
				? "Enabled on Save"
				: "Enabled";
		} catch {
			return "Unknown";
		}
	}

	private getAppliedConfig(section: string, key: string, isResourceScoped = true) {
		const dartValue = this.dartConfig ? this.dartConfig[`${section}.${key}`] : undefined;
		return dartValue !== undefined && dartValue !== null
			? dartValue
			: workspace.getConfiguration(section, isResourceScoped ? this.dummyDartFile : undefined).get(key);
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
			return "My code + Libraries";
		else
			return "My code";
	}

	// All events below should be included in telemetry.json.
	public logExtensionActivated() { this.event(Category.Extension, EventAction.Activated); }
	public logExtensionRestart() { this.event(Category.Extension, EventAction.Restart); }
	public logSdkDetectionFailure() { this.event(Category.Extension, EventAction.SdkDetectionFailure); }
	public logDebuggerStart(debuggerType: string, debuggerRunType: string, sdkDap: boolean) {
		const customData: Partial<AnalyticsData> = {
			debuggerAdapterType: sdkDap ? "SDK" : "Legacy",
			debuggerPreference: this.getDebuggerPreference(),
			debuggerRunType,
			debuggerType,
		};
		this.event(Category.Debugger, EventAction.Activated, customData);
	}
	public logDebuggerOpenDevTools() { this.event(Category.Debugger, EventAction.OpenDevTools); }
	public logFlutterSurveyShown() { this.event(Category.FlutterSurvey, EventAction.Shown); }
	public logFlutterSurveyClicked() { this.event(Category.FlutterSurvey, EventAction.Clicked); }
	public logFlutterSurveyDismissed() { this.event(Category.FlutterSurvey, EventAction.Dismissed); }
	public logFlutterOutlineActivated() {
		if (this.hasLoggedFlutterOutline)
			return;
		this.hasLoggedFlutterOutline = true;
		this.event(Category.FlutterOutline, EventAction.Activated);
	}
	public logCommand(command: EventCommand) { this.event(Category.Command, EventCommand[command]); }
}

interface AnalyticsData {
	anonymize: true,
	eventAction: string,
	eventCategory: string,
	sessionControl?: string,
	language: string,

	isDevExtension: boolean,
	platform: string,
	appName: string | undefined,
	workspaceType: string,
	dartVersion: string | undefined,
	flutterVersion: string | undefined,
	flutterExtension: string,

	analyzerProtocol: string,
	formatter: string,
	showTodos: string,
	closingLabels: string,
	flutterUiGuides: string | undefined,
	flutterHotReloadOnSave: string | undefined,

	// For debugger start events.
	debuggerType?: string,
	debuggerRunType?: string,
	debuggerAdapterType?: string,
	debuggerPreference?: string,
}
