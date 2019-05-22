import { ConfigurationTarget, Uri, version as codeVersion, workspace, WorkspaceConfiguration } from "vscode";
import { createFolderForFile, resolvePaths } from "./utils";
import { NullAsUndefined, nullToUndefined } from "./utils/misc";
import { setupToolEnv } from "./utils/processes";

class Config {
	private config: WorkspaceConfiguration;

	constructor() {
		workspace.onDidChangeConfiguration((e) => this.reloadConfig());
		this.config = workspace.getConfiguration("dart");
		setupToolEnv(this.env);
	}

	private reloadConfig() {
		this.config = workspace.getConfiguration("dart");
		setupToolEnv(this.env);
	}

	private getConfig<T>(key: string, defaultValue: T): NullAsUndefined<T> {
		return nullToUndefined(this.config.get<T>(key, defaultValue));
	}

	private async setConfig<T>(key: string, value: T, target: ConfigurationTarget): Promise<void> {
		await this.config.update(key, value, target);
	}

	get allowAnalytics(): boolean { return this.getConfig<boolean>("allowAnalytics", true); }
	get analysisServerFolding(): boolean { return this.getConfig<boolean>("analysisServerFolding", true); }
	get analyzeAngularTemplates(): boolean { return this.getConfig<boolean>("analyzeAngularTemplates", true); }
	get analyzerAdditionalArgs(): string[] { return this.getConfig<string[]>("analyzerAdditionalArgs", []); }
	get analyzerDiagnosticsPort(): undefined | number { return this.getConfig<null | number>("analyzerDiagnosticsPort", null); }
	get analyzerInstrumentationLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("analyzerInstrumentationLogFile", null))); }
	get analyzerLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("analyzerLogFile", null))); }
	get analyzerObservatoryPort(): undefined | number { return this.getConfig<null | number>("analyzerObservatoryPort", null); }
	get analyzerPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("analyzerPath", null)); }
	get analyzerSshHost(): undefined | string { return this.getConfig<null | string>("analyzerSshHost", null); }
	get autoImportCompletions(): boolean { return this.getConfig<boolean>("autoImportCompletions", true); }
	get buildRunnerAdditionalArgs(): string[] { return this.getConfig<string[]>("buildRunnerAdditionalArgs", []); }
	get checkForSdkUpdates(): boolean { return this.getConfig<boolean>("checkForSdkUpdates", true); }
	get closingLabels(): boolean { return this.getConfig<boolean>("closingLabels", true); }
	get devToolsLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("devToolsLogFile", null))); }
	get devToolsPort(): undefined | number { return this.getConfig<null | number>("devToolsPort", null); }
	get devToolsTheme(): "dark" | "light" { return this.getConfig<"dark" | "light">("devToolsTheme", "dark"); }
	get enableSdkFormatter(): boolean { return this.getConfig<boolean>("enableSdkFormatter", true); }
	get env(): object { return this.getConfig<object>("env", {}); }
	get extensionLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("extensionLogFile", null))); }
	get flutterAdbConnectOnChromeOs(): boolean { return this.getConfig<boolean>("flutterAdbConnectOnChromeOs", false); }
	get flutterCreateAndroidLanguage(): "java" | "kotlin" { return this.getConfig<"java" | "kotlin">("flutterCreateAndroidLanguage", "java"); }
	get flutterCreateIOSLanguage(): "objc" | "swift" { return this.getConfig<"objc" | "swift">("flutterCreateIOSLanguage", "objc"); }
	get flutterCreateOrganization(): undefined | string { return this.getConfig<null | string>("flutterCreateOrganization", null); }
	get flutterDaemonLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("flutterDaemonLogFile", null))); }
	get flutterHotReloadOnSave(): boolean { return this.getConfig<boolean>("flutterHotReloadOnSave", true); }
	get flutterHotRestartOnSave(): boolean { return this.getConfig<boolean>("flutterHotRestartOnSave", false); }
	get flutterScreenshotPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("flutterScreenshotPath", null)); }
	get flutterSdkPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("flutterSdkPath", null)); }
	get flutterSdkPaths(): string[] { return this.getConfig<string[]>("flutterSdkPaths", []).map(resolvePaths); }
	get flutterSelectDeviceWhenConnected(): boolean { return this.getConfig<boolean>("flutterSelectDeviceWhenConnected", true); }
	get maxLogLineLength(): number { return this.getConfig<number>("maxLogLineLength", 2000); }
	get normalizeWindowsDriveLetters(): boolean { return this.getConfig<boolean>("normalizeWindowsDriveLetters", true); }
	get openTestView(): Array<"testRunStart" | "testFailure"> { return this.getConfig<Array<"testRunStart" | "testFailure">>("openTestView", ["testRunStart"]); }
	get previewBuildRunnerTasks(): boolean { return this.getConfig<boolean>("previewBuildRunnerTasks", false); }
	get previewFlutterUiGuides(): boolean { return this.getConfig<boolean>("previewFlutterUiGuides", false); }
	get previewFlutterUiGuidesCustomTracking(): boolean { return this.getConfig<boolean>("previewFlutterUiGuidesCustomTracking", false); }
	get previewToStringInDebugViews(): boolean { return this.getConfig<boolean>("previewToStringInDebugViews", false); }
	get promptToRunIfErrors(): boolean { return this.getConfig<boolean>("promptToRunIfErrors", true); }
	get reportAnalyzerErrors(): boolean { return this.getConfig<boolean>("reportAnalyzerErrors", true); }
	get sdkPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("sdkPath", null)); }
	get sdkPaths(): string[] { return this.getConfig<string[]>("sdkPaths", []).map(resolvePaths); }
	get showIgnoreQuickFixes(): boolean { return this.getConfig<boolean>("showIgnoreQuickFixes", false); }
	get showTestCodeLens(): boolean { return this.getConfig<boolean>("showTestCodeLens", true); }
	get showTodos(): boolean { return this.getConfig<boolean>("showTodos", true); }
	get triggerSignatureHelpAutomatically(): boolean { return this.getConfig<boolean>("triggerSignatureHelpAutomatically", false); }
	get useKnownChromeOSPorts(): boolean { return this.getConfig<boolean>("useKnownChromeOSPorts", true); }
	get warnWhenEditingFilesOutsideWorkspace(): boolean { return this.getConfig<boolean>("warnWhenEditingFilesOutsideWorkspace", true); }

	// Hidden settings
	// TODO: Remove this?
	get previewHotReloadCoverageMarkers() { return this.getConfig<boolean>("previewHotReloadCoverageMarkers", false); }

	// Helpers
	get useDevToolsDarkTheme() { return this.devToolsTheme === "dark"; }
	get openTestViewOnFailure() { return this.openTestView.indexOf("testFailure") !== -1; }
	get openTestViewOnStart() { return this.openTestView.indexOf("testRunStart") !== -1; }

	// Options that can be set programatically.
	public setCheckForSdkUpdates(value: boolean): Thenable<void> { return this.setConfig("checkForSdkUpdates", value, ConfigurationTarget.Global); }
	public setFlutterSdkPath(value: string): Thenable<void> { return this.setConfig("flutterSdkPath", value, ConfigurationTarget.Workspace); }
	public setGlobalDartSdkPath(value: string): Thenable<void> { return this.setConfig("sdkPath", value, ConfigurationTarget.Global); }
	public setGlobalFlutterSdkPath(value: string): Thenable<void> { return this.setConfig("flutterSdkPath", value, ConfigurationTarget.Global); }
	public setSdkPath(value: string): Thenable<void> { return this.setConfig("sdkPath", value, ConfigurationTarget.Workspace); }
	public setWarnWhenEditingFilesOutsideWorkspace(value: boolean): Thenable<void> { return this.setConfig("warnWhenEditingFilesOutsideWorkspace", value, ConfigurationTarget.Global); }

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

	private getConfig<T>(key: string, defaultValue: T): NullAsUndefined<T> {
		return nullToUndefined(this.config.get<T>(key, defaultValue));
	}

	get analysisExcludedFolders(): string[] { return this.getConfig<string[]>("analysisExcludedFolders", []); }
	get debugExternalLibraries(): boolean { return this.getConfig<boolean>("debugExternalLibraries", false); }
	get debugSdkLibraries(): boolean { return this.getConfig<boolean>("debugSdkLibraries", false); }
	get doNotFormat(): string[] { return this.getConfig<string[]>("doNotFormat", []); }
	get enableCompletionCommitCharacters(): boolean { return this.getConfig<boolean>("enableCompletionCommitCharacters", false); }
	get evaluateGettersInDebugViews(): boolean { return this.getConfig<boolean>("evaluateGettersInDebugViews", true); }
	get flutterRunLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("flutterRunLogFile", null))); }
	get flutterTestLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("flutterTestLogFile", null))); }
	get flutterTrackWidgetCreation(): boolean { return this.getConfig<boolean>("flutterTrackWidgetCreation", true); }
	get insertArgumentPlaceholders(): boolean { return this.getConfig<boolean>("insertArgumentPlaceholders", true); }
	get lineLength(): number { return this.getConfig<number>("lineLength", 80); }
	get observatoryLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("observatoryLogFile", null))); }
	get promptToGetPackages(): boolean { return this.getConfig<boolean>("promptToGetPackages", true); }
	get pubAdditionalArgs(): string[] { return this.getConfig<string[]>("pubAdditionalArgs", []); }
	get pubTestLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("pubTestLogFile", null))); }
	get runPubGetOnPubspecChanges(): boolean { return this.getConfig<boolean>("runPubGetOnPubspecChanges", true); }
	get vmAdditionalArgs(): string[] { return this.getConfig<string[]>("vmAdditionalArgs", []); }
	get webDaemonLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("webDaemonLogFile", null))); }

	get runPubGetOnPubspecChangesIsConfiguredExplicitly() {
		const runPubGet = this.config.inspect("runPubGetOnPubspecChanges");
		// Return whether any of them are explicitly set, in which case we'll then read normally from the settings.
		return runPubGet && (runPubGet.globalValue !== undefined || runPubGet.workspaceValue !== undefined || runPubGet.workspaceFolderValue !== undefined);
	}
}

export class CodeCapabilities {
	public version: string;
	constructor(version: string) {
		this.version = version;
	}
	// get requiresEmptyDebugConfigWithNullTypeToOpenLaunchJson() { return !versionIsAtLeast(this.version, "1.27.9"); }
}

export const config = new Config();
export const vsCodeVersion = new CodeCapabilities(codeVersion);
