import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import { env, TelemetryLogger, TelemetrySender, Uri, workspace } from "vscode";
import { dartCodeExtensionIdentifier, isChromeOS, isDartCodeTestRun, isWin } from "../shared/constants";
import { Logger } from "../shared/interfaces";
import { getRandomInt } from "../shared/utils/fs";
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

const sessionId = getRandomInt(0x1000, 0x100000).toString(16);

enum AnalyticsEvent {
	Extension_Activated,
	Extension_Restart,
	SdkDetectionFailure,
	Debugger_Activated,
	DevTools_Opened,
	FlutterSurvey_Shown,
	FlutterSurvey_Clicked,
	FlutterSurvey_Dismissed,
	FlutterOutline_Activated,
	Command_DartNewProject,
	Command_FlutterNewProject,
	Command_AddDependency,
	Command_RestartAnalyzer,
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
			client_id: machineId, // eslint-disable-line camelcase
			events: [{
				name: `${data.eventCategory}_${data.eventAction}`,
				params: {
					"session_id": sessionId,
				},
			}],
			user_properties: this.buildUserProperties(data), // eslint-disable-line camelcase
		};

		if (debug)
			this.logger.info("Sending analytic: " + JSON.stringify(analyticsData));

		const options: https.RequestOptions = {
			headers: {
				"Content-Type": "application/json",
			},
			hostname: "www.google-analytics.com",
			method: "POST",
			path: (debug ? "/debug/mp/collect" : "/mp/collect")
				// Not really secret, is it...
				+ "?api_secret=Y7bcxwkTQ-ekVL0ys4htBA&measurement_id=G-WXNLFN7DDJ",
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
			req.write(JSON.stringify(analyticsData));
			req.on("error", (e) => {
				reject(e);
			});
			req.end();
		});
	}

	private buildUserProperties(data: AnalyticsData & Record<string, any>) {
		const userProperties: { [key: string]: any } = {};

		function add(name: string, value: any) {
			if (value)
				userProperties[name] = { value };
		}

		add("analyzerProtocol", data.analyzerProtocol);
		add("appName", data.appName ?? "Unknown");
		add("appVersion", data["common.extversion"]);
		add("closingLabels", data.closingLabels);
		add("codeVersion", data["common.vscodeversion"]);
		add("dartVersion", data.dartVersion);
		add("debuggerAdapterType", data.debuggerAdapterType);
		add("debuggerPreference", data.debuggerPreference);
		add("debuggerRunType", data.debuggerRunType);
		add("debuggerType", data.debuggerType);
		add("extensionName", data["common.extname"]);
		add("flutterExtension", data.flutterExtension);
		add("flutterHotReloadOnSave", data.flutterHotReloadOnSave);
		add("flutterUiGuides", data.flutterUiGuides);
		add("flutterVersion", data.flutterVersion);
		add("formatter", data.formatter);
		add("isDevExtension", data.isDevExtension);
		add("platform", data.platform);
		add("remotename", data["common.remotename"]);
		add("showTodos", data.showTodos);
		add("userLanguage", data.language);
		add("workspaceType", data.workspaceType);

		return userProperties;
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

	private event(category: AnalyticsEvent, customData?: Partial<AnalyticsData>): void {
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
			event: AnalyticsEvent[category],
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
	public logExtensionActivated() { this.event(AnalyticsEvent.Extension_Activated); }
	public logExtensionRestart() { this.event(AnalyticsEvent.Extension_Restart); }
	public logSdkDetectionFailure() { this.event(AnalyticsEvent.SdkDetectionFailure); }
	public logDebuggerStart(debuggerType: string, debuggerRunType: string, sdkDap: boolean) {
		const customData: Partial<AnalyticsData> = {
			debuggerAdapterType: sdkDap ? "SDK" : "Legacy",
			debuggerPreference: this.getDebuggerPreference(),
			debuggerRunType,
			debuggerType,
		};
		this.event(AnalyticsEvent.Debugger_Activated, customData);
	}
	public logDevToolsOpened() { this.event(AnalyticsEvent.DevTools_Opened); }
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
}

interface AnalyticsData {
	anonymize: true,
	event: string,
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
