import { ConfigurationTarget, Uri, version as codeVersion, workspace, WorkspaceConfiguration } from "vscode";
import { createFolderForFile, resolvePaths, versionIsAtLeast } from "./utils";

class Config {
	private config: WorkspaceConfiguration;

	constructor() {
		workspace.onDidChangeConfiguration((e) => this.loadConfig());
		this.loadConfig();
	}

	private loadConfig() {
		this.config = workspace.getConfiguration("dart");
	}

	private getConfig<T>(key: string): T | undefined {
		return this.config.get<T>(key);
	}

	private async setConfig<T>(key: string, value: T, target: ConfigurationTarget): Promise<void> {
		await this.config.update(key, value, target);
		this.loadConfig(); // TODO: Do we need this or does it get done via onDidChangeConfiguration?
	}

	get allowAnalytics() { return this.getConfig<boolean>("allowAnalytics"); }
	get analysisServerFolding() { return this.getConfig<boolean>("analysisServerFolding"); }
	get analyzeAngularTemplates() { return this.getConfig<boolean>("analyzeAngularTemplates"); }
	get analyzerAdditionalArgs() { return this.getConfig<string[]>("analyzerAdditionalArgs"); }
	get analyzerDiagnosticsPort() { return this.getConfig<number>("analyzerDiagnosticsPort"); }
	get analyzerInstrumentationLogFile() { return createFolderForFile(resolvePaths(this.getConfig<string>("analyzerInstrumentationLogFile"))); }
	get analyzerLogFile() { return createFolderForFile(resolvePaths(this.getConfig<string>("analyzerLogFile"))); }
	get analyzerObservatoryPort() { return this.getConfig<number>("analyzerObservatoryPort"); }
	get analyzerPath() { return resolvePaths(this.getConfig<string>("analyzerPath")); }
	get analyzerSshHost() { return this.getConfig<string>("analyzerSshHost"); }
	get checkForSdkUpdates() { return this.getConfig<boolean>("checkForSdkUpdates"); }
	public setCheckForSdkUpdates(value: boolean): Thenable<void> { return this.setConfig("checkForSdkUpdates", value, ConfigurationTarget.Global); }
	get closingLabels() { return this.getConfig<boolean>("closingLabels"); }
	get extensionLogFile() { return createFolderForFile(resolvePaths(this.getConfig<string>("extensionLogFile"))); }
	get flutterCreateAndroidLanguage() { return this.getConfig<string>("flutterCreateAndroidLanguage"); }
	get flutterCreateIOSLanguage() { return this.getConfig<string>("flutterCreateIOSLanguage"); }
	get flutterCreateOrganization() { return this.getConfig<string>("flutterCreateOrganization"); }
	get flutterDaemonLogFile() { return createFolderForFile(resolvePaths(this.getConfig<string>("flutterDaemonLogFile"))); }
	get flutterHotReloadOnSave() { return this.getConfig<boolean>("flutterHotReloadOnSave"); }
	get flutterScreenshotPath() { return resolvePaths(this.getConfig<string>("flutterScreenshotPath")); }
	get flutterSdkPath() { return resolvePaths(this.getConfig<string>("flutterSdkPath")); }
	public setFlutterSdkPath(value: string): Thenable<void> { return this.setConfig("flutterSdkPath", value, ConfigurationTarget.Workspace); }
	get flutterSdkPaths() { return (this.getConfig<string[]>("flutterSdkPaths") || []).map(resolvePaths); }
	get flutterSelectDeviceWhenConnected() { return this.getConfig<boolean>("flutterSelectDeviceWhenConnected"); }
	get normalizeWindowsDriveLetters() { return this.getConfig<boolean>("normalizeWindowsDriveLetters"); }
	get maxLogLineLength() { return this.getConfig<number>("maxLogLineLength"); }
	get openTestView() { return this.getConfig<string[]>("openTestView") || []; }
	get openTestViewOnFailure() { return this.openTestView.indexOf("testFailure") !== -1; }
	get openTestViewOnStart() { return this.openTestView.indexOf("testRunStart") !== -1; }
	get reportAnalyzerErrors() { return this.getConfig<boolean>("reportAnalyzerErrors"); }
	get sdkPath() { return resolvePaths(this.getConfig<string>("sdkPath")) || undefined; }
	public setSdkPath(value: string): Thenable<void> { return this.setConfig("sdkPath", value, ConfigurationTarget.Workspace); }
	get sdkPaths() { return (this.getConfig<string[]>("sdkPaths") || []).map(resolvePaths); }
	get showTestCodeLens() { return this.getConfig<boolean>("showTestCodeLens"); }
	get showTodos() { return this.getConfig<boolean>("showTodos"); }
	get triggerSignatureHelpAutomatically() { return this.getConfig<boolean>("triggerSignatureHelpAutomatically"); }
	get warnWhenEditingFilesOutsideWorkspace() { return this.getConfig<boolean>("warnWhenEditingFilesOutsideWorkspace"); }

	public setGlobalDartSdkPath(value: string): Thenable<void> { return this.setConfig("sdkPath", value, ConfigurationTarget.Global); }
	public setGlobalFlutterSdkPath(value: string): Thenable<void> { return this.setConfig("flutterSdkPath", value, ConfigurationTarget.Global); }

	// Preview features.
	get previewHotReloadCoverageMarkers() { return this.getConfig<boolean>("previewHotReloadCoverageMarkers"); }
	get previewToStringInDebugViews() { return this.getConfig<boolean>("previewToStringInDebugViews"); }

	public for(uri?: Uri): ResourceConfig {
		return new ResourceConfig(uri);
	}
}

class ResourceConfig {
	public uri?: Uri;
	public config: WorkspaceConfiguration;

	constructor(uri?: Uri) {
		this.uri = uri;
		this.config = workspace.getConfiguration("dart", this.uri);
	}

	private getConfig<T>(key: string): T | undefined {
		return this.config.get<T>(key);
	}

	get debugSdkLibraries() { return this.getConfig<boolean>("debugSdkLibraries"); }
	get debugExternalLibraries() { return this.getConfig<boolean>("debugExternalLibraries"); }
	get doNotFormat() { return this.getConfig<string[]>("doNotFormat"); }
	get enableCompletionCommitCharacters() { return this.getConfig<boolean>("enableCompletionCommitCharacters"); }
	get evaluateGettersInDebugViews() { return this.getConfig<boolean>("evaluateGettersInDebugViews"); }
	get flutterTrackWidgetCreation() { return this.getConfig<boolean>("flutterTrackWidgetCreation"); }
	get insertArgumentPlaceholders() { return this.getConfig<boolean>("insertArgumentPlaceholders"); }
	get lineLength() { return this.getConfig<number>("lineLength"); }
	get pubAdditionalArgs() { return this.getConfig<string[]>("pubAdditionalArgs"); }
	get runPubGetOnPubspecChanges() { return this.getConfig<boolean>("runPubGetOnPubspecChanges"); }
	get runPubGetOnPubspecChangesIsConfiguredExplicitly() {
		const runPubSpec = this.config.inspect("runPubGetOnPubspecChanges");
		// Return whether any of them are explicitly set, in which case we'll then read normally from the settings.
		return runPubSpec.globalValue !== undefined || runPubSpec.workspaceValue !== undefined || runPubSpec.workspaceFolderValue !== undefined;
	}
	get flutterRunLogFile() { return createFolderForFile(resolvePaths(this.getConfig<string>("flutterRunLogFile"))); }
	get flutterTestLogFile() { return createFolderForFile(resolvePaths(this.getConfig<string>("flutterTestLogFile"))); }
	get observatoryLogFile() { return createFolderForFile(resolvePaths(this.getConfig<string>("observatoryLogFile"))); }
	get pubTestLogFile() { return createFolderForFile(resolvePaths(this.getConfig<string>("pubTestLogFile"))); }
	get promptToGetPackages() { return this.getConfig<boolean>("promptToGetPackages"); }
	get vmAdditionalArgs() { return this.getConfig<string[]>("vmAdditionalArgs"); }
}

export class CodeCapabilities {
	public version: string;
	constructor(version: string) {
		this.version = version;
	}
	// HACK: Use 1.27.9 because 1.28 doesn't match 1.28.0-insiders, and it's highly unlikely there will be 7 more minor
	// releases before v1.28 ships.
	get requiresEmptyDebugConfigWithNullTypeToOpenLaunchJson() { return !versionIsAtLeast(this.version, "1.27.9"); }
}

export const config = new Config();
export const vsCodeVersion = new CodeCapabilities(codeVersion);
