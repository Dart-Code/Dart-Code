import { ConfigurationTarget, Uri, workspace, WorkspaceConfiguration } from "vscode";
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
		const value = this.config.get<T>(key, defaultValue);
		return nullToUndefined(value);
	}

	private getWorkspaceConfig<T>(key: string): NullAsUndefined<T> {
		const c = this.config.inspect<T>(key);

		if (c && c.workspaceValue)
			return nullToUndefined(c.workspaceValue);

		if (c && c.workspaceFolderValue)
			return nullToUndefined(c.workspaceFolderValue);

		return undefined as NullAsUndefined<T>;
	}

	private async setConfig<T>(key: string, value: T, target: ConfigurationTarget): Promise<void> {
		await this.config.update(key, value, target);
	}

	get additionalAnalyzerFileExtensions(): string[] { return this.getConfig<string[]>("additionalAnalyzerFileExtensions", []); }
	get allowAnalytics(): boolean { return this.getConfig<boolean>("allowAnalytics", true); }
	get allowTestsOutsideTestFolder(): boolean { return this.getConfig<boolean>("allowTestsOutsideTestFolder", false); }
	get analysisServerFolding(): boolean { return this.getConfig<boolean>("analysisServerFolding", true); }
	get analyzeAngularTemplates(): boolean { return this.getConfig<boolean>("analyzeAngularTemplates", true); }
	get analyzerAdditionalArgs(): string[] { return this.getConfig<string[]>("analyzerAdditionalArgs", []); }
	get analyzerDiagnosticsPort(): undefined | number { return this.getConfig<null | number>("analyzerDiagnosticsPort", null); }
	get analyzerInstrumentationLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("analyzerInstrumentationLogFile", null))); }
	get analyzerLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("analyzerLogFile", null))); }
	get analyzerPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("analyzerPath", null)); }
	get analyzerSshHost(): undefined | string { return this.getConfig<null | string>("analyzerSshHost", null); }
	get analyzerVmServicePort(): undefined | number { return this.getConfig<null | number>("analyzerVmServicePort", null); }
	get autoImportCompletions(): boolean { return this.getConfig<boolean>("autoImportCompletions", true); }
	get buildRunnerAdditionalArgs(): string[] { return this.getConfig<string[]>("buildRunnerAdditionalArgs", []); }
	get checkForSdkUpdates(): boolean { return this.getConfig<boolean>("checkForSdkUpdates", true); }
	get closingLabels(): boolean { return this.getConfig<boolean>("closingLabels", true); }
	get debugExternalLibraries(): boolean { return this.getConfig<boolean>("debugExternalLibraries", false); }
	get debugSdkLibraries(): boolean { return this.getConfig<boolean>("debugSdkLibraries", false); }
	get devToolsLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("devToolsLogFile", null))); }
	get devToolsPort(): undefined | number { return this.getConfig<null | number>("devToolsPort", null); }
	get devToolsReuseWindows(): boolean { return this.getConfig<boolean>("devToolsReuseWindows", true); }
	get devToolsTheme(): "dark" | "light" { return this.getConfig<"dark" | "light">("devToolsTheme", "dark"); }
	get enableSdkFormatter(): boolean { return this.getConfig<boolean>("enableSdkFormatter", true); }
	get env(): object { return this.getConfig<object>("env", {}); }
	get evaluateToStringInDebugViews(): boolean { return this.getConfig<boolean>("evaluateToStringInDebugViews", false); }
	get extensionLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("extensionLogFile", null))); }
	get flutterAdbConnectOnChromeOs(): boolean { return this.getConfig<boolean>("flutterAdbConnectOnChromeOs", false); }
	get flutterAndroidX(): boolean { return this.getConfig<boolean>("flutterAndroidX", false); }
	get flutterCreateAndroidLanguage(): "java" | "kotlin" { return this.getConfig<"java" | "kotlin">("flutterCreateAndroidLanguage", "kotlin"); }
	get flutterCreateIOSLanguage(): "objc" | "swift" { return this.getConfig<"objc" | "swift">("flutterCreateIOSLanguage", "swift"); }
	get flutterCreateOffline(): boolean { return this.getConfig<boolean>("flutterCreateOffline", false); }
	get flutterCreateOrganization(): undefined | string { return this.getConfig<null | string>("flutterCreateOrganization", null); }
	get flutterCustomEmulators(): Array<{ id: string, name: string, executable: string, args?: string[] }> { return this.getConfig<Array<{ id: string, name: string, executable: string, args?: string[] }>>("flutterCustomEmulators", []); }
	get flutterDaemonLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("flutterDaemonLogFile", null))); }
	get flutterGutterIcons(): boolean { return this.getConfig<boolean>("flutterGutterIcons", true); }
	get flutterHotReloadOnSave(): boolean { return this.getConfig<boolean>("flutterHotReloadOnSave", true); }
	get flutterHotRestartOnSave(): boolean { return this.getConfig<boolean>("flutterHotRestartOnSave", true); }
	get flutterOutline(): boolean { return this.getConfig<boolean>("flutterOutline", true); }
	get flutterRunLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("flutterRunLogFile", null))); }
	get flutterScreenshotPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("flutterScreenshotPath", null)); }
	get flutterSdkPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("flutterSdkPath", null)); }
	get flutterSdkPaths(): string[] { return this.getConfig<string[]>("flutterSdkPaths", []).map(resolvePaths); }
	get flutterSelectDeviceWhenConnected(): boolean { return this.getConfig<boolean>("flutterSelectDeviceWhenConnected", true); }
	get flutterTestLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("flutterTestLogFile", null))); }
	get maxLogLineLength(): number { return this.getConfig<number>("maxLogLineLength", 2000); }
	get notifyAnalyzerErrors(): boolean { return this.getConfig<boolean>("notifyAnalyzerErrors", true); }
	get openDevTools(): "never" | "flutter" | "always" { return this.getConfig<"never" | "flutter" | "always">("openDevTools", "never"); }
	get openTestView(): Array<"testRunStart" | "testFailure"> { return this.getConfig<Array<"testRunStart" | "testFailure">>("openTestView", ["testRunStart"]); }
	get previewBazelWorkspaceCustomScripts(): boolean { return this.getConfig<boolean>("previewBazelWorkspaceCustomScripts", false); }
	get previewBuildRunnerTasks(): boolean { return this.getConfig<boolean>("previewBuildRunnerTasks", false); }
	get previewEmbeddedDevTools(): boolean { return this.getConfig<boolean>("previewEmbeddedDevTools", false); }
	get previewFlutterUiGuides(): boolean { return this.getConfig<boolean>("previewFlutterUiGuides", false); }
	get previewFlutterUiGuidesCustomTracking(): boolean { return this.getConfig<boolean>("previewFlutterUiGuidesCustomTracking", false); }
	get previewHotReloadOnSaveWatcher(): boolean { return this.getConfig<boolean>("previewHotReloadOnSaveWatcher", false); }
	get previewLsp(): boolean { return this.getConfig<boolean>("previewLsp", false); }
	get updateImportsOnRename(): boolean { return this.getConfig<boolean>("updateImportsOnRename", true); }
	get promptToRunIfErrors(): boolean { return this.getConfig<boolean>("promptToRunIfErrors", true); }
	get pubTestLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("pubTestLogFile", null))); }
	get sdkPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("sdkPath", null)); }
	get sdkPaths(): string[] { return this.getConfig<string[]>("sdkPaths", []).map(resolvePaths); }
	get showDartPadSampleCodeLens(): boolean { return this.getConfig<boolean>("showDartPadSampleCodeLens", true); }
	get showIgnoreQuickFixes(): boolean { return this.getConfig<boolean>("showIgnoreQuickFixes", true); }
	get showMainCodeLens(): boolean { return this.getConfig<boolean>("showMainCodeLens", true); }
	get showTestCodeLens(): boolean { return this.getConfig<boolean>("showTestCodeLens", true); }
	get showTodos(): boolean { return this.getConfig<boolean>("showTodos", true); }
	get triggerSignatureHelpAutomatically(): boolean { return this.getConfig<boolean>("triggerSignatureHelpAutomatically", false); }
	get useKnownChromeOSPorts(): boolean { return this.getConfig<boolean>("useKnownChromeOSPorts", true); }
	get vmServiceLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("vmServiceLogFile", null))); }
	get warnWhenEditingFilesOutsideWorkspace(): boolean { return this.getConfig<boolean>("warnWhenEditingFilesOutsideWorkspace", true); }
	get webDaemonLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("webDaemonLogFile", null))); }

	// Helpers
	get useDevToolsDarkTheme() { return this.devToolsTheme === "dark"; }
	get openTestViewOnFailure() { return this.openTestView.indexOf("testFailure") !== -1; }
	get openTestViewOnStart() { return this.openTestView.indexOf("testRunStart") !== -1; }

	get workspaceSdkPath(): undefined | string { return resolvePaths(this.getWorkspaceConfig<null | string>("sdkPath")); }
	get workspaceFlutterSdkPath(): undefined | string { return resolvePaths(this.getWorkspaceConfig<null | string>("flutterSdkPath")); }

	// Options that can be set programatically.
	public setCheckForSdkUpdates(value: boolean): Thenable<void> { return this.setConfig("checkForSdkUpdates", value, ConfigurationTarget.Global); }
	public setFlutterSdkPath(value: string | undefined): Thenable<void> { return this.setConfig("flutterSdkPath", value, ConfigurationTarget.Workspace); }
	public setGlobalDartSdkPath(value: string): Thenable<void> { return this.setConfig("sdkPath", value, ConfigurationTarget.Global); }
	public setGlobalDebugSdkLibraries(value: boolean): Thenable<void> { return this.setConfig("debugSdkLibraries", value, ConfigurationTarget.Global); }
	public setGlobalDebugExternalLibraries(value: boolean): Thenable<void> { return this.setConfig("debugExternalLibraries", value, ConfigurationTarget.Global); }
	public setGlobalFlutterSdkPath(value: string): Thenable<void> { return this.setConfig("flutterSdkPath", value, ConfigurationTarget.Global); }
	public setOpenDevTools(value: "never" | "flutter" | "always" | undefined): Thenable<void> { return this.setConfig("openDevTools", value, ConfigurationTarget.Global); }
	public setSdkPath(value: string | undefined): Thenable<void> { return this.setConfig("sdkPath", value, ConfigurationTarget.Workspace); }
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
	get analyzerInstrumentationLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("analyzerInstrumentationLogFile", null))); }
	get analyzerLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("analyzerLogFile", null))); }
	get analyzerPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("analyzerPath", null)); }
	get devToolsLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("devToolsLogFile", null))); }
	get doNotFormat(): string[] { return this.getConfig<string[]>("doNotFormat", []); }
	get enableCompletionCommitCharacters(): boolean { return this.getConfig<boolean>("enableCompletionCommitCharacters", false); }
	get evaluateGettersInDebugViews(): boolean { return this.getConfig<boolean>("evaluateGettersInDebugViews", true); }
	get extensionLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("extensionLogFile", null))); }
	get flutterAdditionalArgs(): string[] { return this.getConfig<string[]>("flutterAdditionalArgs", []); }
	get flutterDaemonLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("flutterDaemonLogFile", null))); }
	get flutterRunLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("flutterRunLogFile", null))); }
	get flutterScreenshotPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("flutterScreenshotPath", null)); }
	get flutterSdkPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("flutterSdkPath", null)); }
	get flutterSdkPaths(): string[] { return this.getConfig<string[]>("flutterSdkPaths", []).map(resolvePaths); }
	get flutterStructuredErrors(): boolean { return this.getConfig<boolean>("flutterStructuredErrors", true); }
	get flutterTestLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("flutterTestLogFile", null))); }
	get flutterTrackWidgetCreation(): boolean { return this.getConfig<boolean>("flutterTrackWidgetCreation", true); }
	get insertArgumentPlaceholders(): boolean { return this.getConfig<boolean>("insertArgumentPlaceholders", true); }
	get lineLength(): number { return this.getConfig<number>("lineLength", 80); }
	get promptToGetPackages(): boolean { return this.getConfig<boolean>("promptToGetPackages", true); }
	get pubAdditionalArgs(): string[] { return this.getConfig<string[]>("pubAdditionalArgs", []); }
	get pubTestLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("pubTestLogFile", null))); }
	get runPubGetOnPubspecChanges(): boolean { return this.getConfig<boolean>("runPubGetOnPubspecChanges", true); }
	get sdkPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("sdkPath", null)); }
	get sdkPaths(): string[] { return this.getConfig<string[]>("sdkPaths", []).map(resolvePaths); }
	get showDartDeveloperLogs(): boolean { return this.getConfig<boolean>("showDartDeveloperLogs", true); }
	get vmAdditionalArgs(): string[] { return this.getConfig<string[]>("vmAdditionalArgs", []); }
	get vmServiceLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("vmServiceLogFile", null))); }
	get webDaemonLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("webDaemonLogFile", null))); }
}

export const config = new Config();
