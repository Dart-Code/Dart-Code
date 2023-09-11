import { ConfigurationTarget, Uri, workspace, WorkspaceConfiguration } from "vscode";
import { CustomDevToolsConfig } from "../shared/interfaces";
import { NullAsUndefined, nullToUndefined } from "../shared/utils";
import { createFolderForFile, resolvePaths } from "./utils";
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
			return c.workspaceValue;

		if (c && c.workspaceFolderValue) {
			return c.workspaceFolderValue;
		}

		return undefined as NullAsUndefined<T>;
	}

	private async setConfig<T>(key: string, value: T, target: ConfigurationTarget): Promise<void> {
		await this.config.update(key, value, target);
	}

	get addSdkToTerminalPath(): boolean { return this.getConfig<boolean>("addSdkToTerminalPath", true); }
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
	get analyzerVmAdditionalArgs(): string[] { return this.getConfig<string[]>("analyzerVmAdditionalArgs", []); }
	get analyzerVmServicePort(): undefined | number { return this.getConfig<null | number>("analyzerVmServicePort", null); }
	get autoImportCompletions(): boolean { return this.getConfig<boolean>("autoImportCompletions", true); }
	get automaticCommentSlashes(): "none" | "tripleSlash" | "all" { return this.getConfig<"none" | "tripleSlash" | "all">("automaticCommentSlashes", "tripleSlash"); }
	get buildRunnerAdditionalArgs(): string[] { return this.getConfig<string[]>("buildRunnerAdditionalArgs", []); }
	get checkForSdkUpdates(): boolean { return this.getConfig<boolean>("checkForSdkUpdates", true); }
	get cliConsole(): "debugConsole" | "terminal" | "externalTerminal" { return this.getConfig<"debugConsole" | "terminal" | "externalTerminal">("cliConsole", "debugConsole"); }
	get closingLabels(): boolean { return this.getConfig<boolean>("closingLabels", true); }
	get completionBudgetMilliseconds(): number | undefined { return this.getConfig<number | undefined>("completionBudgetMilliseconds", undefined); }
	get customDartDapPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("customDartDapPath", null)); }
	get customDevTools(): undefined | CustomDevToolsConfig { return this.getConfig<null | CustomDevToolsConfig>("customDevTools", null); }
	get customFlutterDapPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("customFlutterDapPath", null)); }
	get dapLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("dapLogFile", null))); }
	get dartTestLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("dartTestLogFile", null))); }
	get daemonPort(): undefined | number { return this.getConfig<null | number>("daemonPort", null); }
	get debugExtensionBackendProtocol(): "sse" | "ws" { return this.getConfig<"sse" | "ws">("debugExtensionBackendProtocol", "ws"); }
	get debugExternalPackageLibraries(): boolean { return this.getConfig<boolean>("debugExternalPackageLibraries", false); }
	get debugSdkLibraries(): boolean { return this.getConfig<boolean>("debugSdkLibraries", false); }
	get devToolsBrowser(): "chrome" | "default" { return this.getConfig<"chrome" | "default">("devToolsBrowser", "chrome"); }
	get devToolsLocation(): "beside" | "active" | "external" { return this.getConfig<"beside" | "active" | "external">("devToolsLocation", "beside"); }
	get devToolsLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("devToolsLogFile", null))); }
	get devToolsPort(): undefined | number { return this.getConfig<null | number>("devToolsPort", null); }
	get devToolsReuseWindows(): boolean { return this.getConfig<boolean>("devToolsReuseWindows", true); }
	get devToolsTheme(): "dark" | "light" { return this.getConfig<"dark" | "light">("devToolsTheme", "dark"); }
	get documentation(): string | undefined { return this.getConfig<string | undefined>("documentation", undefined); }
	get enableSdkFormatter(): boolean { return this.getConfig<boolean>("enableSdkFormatter", true); }
	get enableServerSnippets(): boolean { return this.getConfig<boolean>("enableServerSnippets", true); }
	get enableSnippets(): boolean { return this.getConfig<boolean>("enableSnippets", true); }
	get env(): any { return this.getConfig<any>("env", {}); }
	get evaluateToStringInDebugViews(): boolean { return this.getConfig<boolean>("evaluateToStringInDebugViews", true); }
	get experimentalRefactors(): boolean { return this.getConfig<boolean>("experimentalRefactors", false); }
	get extensionLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("extensionLogFile", null))); }
	get experimentalTestRunnerInSdk(): boolean { return this.getConfig<boolean>("experimentalTestRunnerInSdk", false); }
	get flutterAdbConnectOnChromeOs(): boolean { return this.getConfig<boolean>("flutterAdbConnectOnChromeOs", false); }
	get flutterCreateAndroidLanguage(): "java" | "kotlin" { return this.getConfig<"java" | "kotlin">("flutterCreateAndroidLanguage", "kotlin"); }
	get flutterCreateIOSLanguage(): "objc" | "swift" { return this.getConfig<"objc" | "swift">("flutterCreateIOSLanguage", "swift"); }
	get flutterCreateOffline(): boolean { return this.getConfig<boolean>("flutterCreateOffline", false); }
	get flutterCreateOrganization(): undefined | string { return this.getConfig<null | string>("flutterCreateOrganization", null); }
	get flutterCreatePlatforms(): string[] | undefined { return this.getConfig<string[] | undefined>("flutterCreatePlatforms", undefined); }
	get flutterCustomEmulators(): Array<{ id: string, name: string, executable: string, args?: string[] }> { return this.getConfig<Array<{ id: string, name: string, executable: string, args?: string[] }>>("flutterCustomEmulators", []); }
	get flutterDaemonLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("flutterDaemonLogFile", null))); }
	get flutterGenerateLocalizationsOnSave(): "never" | "manual" | "manualIfDirty" | "all" | "allIfDirty" { return this.getConfig<"never" | "manual" | "manualIfDirty" | "all" | "allIfDirty">("flutterGenerateLocalizationsOnSave", "never"); }
	get flutterGutterIcons(): boolean { return this.getConfig<boolean>("flutterGutterIcons", true); }
	get flutterHotReloadOnSave(): "never" | "manual" | "manualIfDirty" | "all" | "allIfDirty" {
		const value = this.getConfig<"never" | "manual" | "manualIfDirty" | "all" | "allIfDirty" | "always" | true | false>("flutterHotReloadOnSave", "manual");
		// Convert the legacy values to new values, if required.
		if (value === true)
			return "manual";
		else if (value === false)
			return "never";
		else if (value === "always")
			return "all";
		else
			return value;
	}
	get flutterOutline(): boolean { return this.getConfig<boolean>("flutterOutline", true); }
	get flutterRememberSelectedDevice(): boolean { return this.getConfig<boolean>("flutterRememberSelectedDevice", true); }
	get flutterRunLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("flutterRunLogFile", null))); }
	get flutterScreenshotPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("flutterScreenshotPath", null)); }
	get flutterSdkPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("flutterSdkPath", null)); }
	get flutterSdkPaths(): string[] { return this.getConfig<string[]>("flutterSdkPaths", []).map(resolvePaths); }
	get flutterSelectDeviceWhenConnected(): boolean { return this.getConfig<boolean>("flutterSelectDeviceWhenConnected", true); }
	get flutterShowEmulators(): "local" | "always" | "never" { return this.getConfig<"local" | "always" | "never">("flutterShowEmulators", "local"); }
	get flutterShowWebServerDevice(): "remote" | "always" { return this.getConfig<"remote" | "always">("flutterShowWebServerDevice", "remote"); }
	get flutterTestLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("flutterTestLogFile", null))); }
	get flutterWebRenderer(): "auto" | "html" | "canvaskit" { return this.getConfig<"auto" | "html" | "canvaskit">("flutterWebRenderer", "auto"); }
	get hotReloadOnSave(): "never" | "manual" | "manualIfDirty" | "all" | "allIfDirty" {
		const value = this.getConfig<"never" | "manual" | "manualIfDirty" | "all" | "allIfDirty" | "always">("hotReloadOnSave", "never");
		if (value === "always")
			return "all";
		else
			return value;
	}
	get hotReloadProgress(): "notification" | "statusBar" { return this.getConfig<"notification" | "statusBar">("hotReloadProgress", "notification"); }
	get includeDependenciesInWorkspaceSymbols(): boolean { return this.getConfig<boolean>("includeDependenciesInWorkspaceSymbols", true); }
	get lspSnippetTextEdits(): boolean { return this.getConfig<boolean>("lspSnippetTextEdits", true); }
	get maxCompletionItems(): number | undefined { return this.getConfig<number | undefined>("maxCompletionItems", undefined); }
	get maxLogLineLength(): number { return this.getConfig<number>("maxLogLineLength", 2000); }
	get normalizeFileCasing(): boolean { return this.getConfig<boolean>("normalizeFileCasing", false); }
	get notifyAnalyzerErrors(): boolean { return this.getConfig<boolean>("notifyAnalyzerErrors", true); }
	get offline(): boolean { return this.getConfig<boolean>("offline", false); }
	get onlyAnalyzeProjectsWithOpenFiles(): boolean { return this.getConfig<boolean>("onlyAnalyzeProjectsWithOpenFiles", false); }
	get openDevTools(): "never" | "flutter" | "always" { return this.getConfig<"never" | "flutter" | "always">("openDevTools", "never"); }
	get openTestView(): Array<"testRunStart" | "testFailure"> { return this.getConfig<Array<"testRunStart" | "testFailure">>("openTestView", ["testRunStart"]); }
	get previewCommitCharacters(): boolean { return this.getConfig<boolean>("previewCommitCharacters", false); }
	get previewFlutterUiGuides(): boolean { return this.getConfig<boolean>("previewFlutterUiGuides", false); }
	get previewFlutterUiGuidesCustomTracking(): boolean { return this.getConfig<boolean>("previewFlutterUiGuidesCustomTracking", false); }
	get previewHotReloadOnSaveWatcher(): boolean { return this.getConfig<boolean>("previewHotReloadOnSaveWatcher", false); }
	get previewSdkDaps(): undefined | boolean { return this.getConfig<null | boolean>("previewSdkDaps", null); }
	get previewSurveys(): boolean { return this.getConfig<boolean>("previewSurveys", false); }
	get projectSearchDepth(): number { return this.getConfig<number>("projectSearchDepth", 5); }
	get promptToRunIfErrors(): boolean { return this.getConfig<boolean>("promptToRunIfErrors", true); }
	get renameFilesWithClasses(): "never" | "prompt" | "always" { return this.getConfig<"never" | "prompt" | "always">("renameFilesWithClasses", "never"); }
	get runPubGetOnNestedProjects(): "none" | "both" | "above" | "below" { return this.getConfig<"none" | "both" | "above" | "below">("runPubGetOnNestedProjects", "none"); }
	get sdkPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("sdkPath", null)); }
	get sdkPaths(): string[] { return this.getConfig<string[]>("sdkPaths", []).map(resolvePaths); }
	get sdkSwitchingTarget(): "workspace" | "global" { return this.getConfig<"workspace" | "global">("sdkSwitchingTarget", "workspace"); }
	get shareDevToolsWithFlutter(): boolean { return this.getConfig<boolean>("shareDevToolsWithFlutter", true); }
	get showDartPadSampleCodeLens(): boolean { return this.getConfig<boolean>("showDartPadSampleCodeLens", true); }
	get showDebuggerNumbersAsHex(): boolean { return this.getConfig<boolean>("showDebuggerNumbersAsHex", false); }
	get showDevToolsDebugToolBarButtons(): boolean { return this.getConfig<boolean>("showDevToolsDebugToolBarButtons", true); }
	get showInspectorNotificationsForWidgetErrors(): boolean { return this.getConfig<boolean>("showInspectorNotificationsForWidgetErrors", true); }
	get showMainCodeLens(): boolean { return this.getConfig<boolean>("showMainCodeLens", true); }
	get showSkippedTests(): boolean { return this.getConfig<boolean>("showSkippedTests", true); }
	get showTestCodeLens(): boolean { return this.getConfig<boolean>("showTestCodeLens", true); }
	get showTodos(): boolean | string[] { return this.getConfig<boolean | string[]>("showTodos", true); }
	get testInvocationMode(): "name" | "line" { return this.getConfig<"name" | "line">("testInvocationMode", "name"); }
	get updateDevTools(): boolean { return this.getConfig<boolean>("updateDevTools", true); }
	get updateImportsOnRename(): boolean { return this.getConfig<boolean>("updateImportsOnRename", true); }
	get useLegacyAnalyzerProtocol(): boolean { return this.getConfig<boolean>("useLegacyAnalyzerProtocol", false); }
	get vmServiceLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("vmServiceLogFile", null))); }
	get warnWhenEditingFilesInPubCache(): boolean { return this.getConfig<boolean>("warnWhenEditingFilesInPubCache", true); }
	get warnWhenEditingFilesOutsideWorkspace(): boolean { return this.getConfig<boolean>("warnWhenEditingFilesOutsideWorkspace", true); }
	get webDaemonLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("webDaemonLogFile", null))); }

	// Helpers
	get useDevToolsDarkTheme() { return this.devToolsTheme === "dark"; }
	get openTestViewOnFailure() { return this.openTestView.indexOf("testFailure") !== -1; }
	get openTestViewOnStart() { return this.openTestView.indexOf("testRunStart") !== -1; }

	get workspaceSdkPath(): undefined | string { return resolvePaths(this.getWorkspaceConfig<null | string>("sdkPath")); }
	get workspaceFlutterSdkPath(): undefined | string { return resolvePaths(this.getWorkspaceConfig<null | string>("flutterSdkPath")); }

	// Options that can be set programatically.
	public setShowDebuggerNumbersAsHex(value: true | undefined): Promise<void> { return this.setConfig("showDebuggerNumbersAsHex", value, ConfigurationTarget.Global); }
	public setCheckForSdkUpdates(value: boolean): Promise<void> { return this.setConfig("checkForSdkUpdates", value, ConfigurationTarget.Global); }
	public setFlutterCreateOrganization(value: string | undefined): Promise<void> { return this.setConfig("flutterCreateOrganization", value, ConfigurationTarget.Global); }
	public setFlutterCreateAndroidLanguage(value: "java" | "kotlin" | undefined): Promise<void> { return this.setConfig("flutterCreateAndroidLanguage", value, ConfigurationTarget.Global); }
	public setFlutterCreateIOSLanguage(value: "objc" | "swift" | undefined): Promise<void> { return this.setConfig("flutterCreateIOSLanguage", value, ConfigurationTarget.Global); }
	public setFlutterCreatePlatforms(value: string[] | undefined): Promise<void> { return this.setConfig("flutterCreatePlatforms", value, ConfigurationTarget.Global); }
	public setFlutterSdkPath(value: string | undefined, target: ConfigurationTarget): Promise<void> { return this.setConfig("flutterSdkPath", value, target); }
	public setGlobalDartSdkPath(value: string): Promise<void> { return this.setConfig("sdkPath", value, ConfigurationTarget.Global); }
	public setGlobalDebugSdkLibraries(value: boolean): Promise<void> { return this.setConfig("debugSdkLibraries", value, ConfigurationTarget.Global); }
	public setGlobalDebugExternalPackageLibraries(value: boolean): Promise<void> { return this.setConfig("debugExternalPackageLibraries", value, ConfigurationTarget.Global); }
	public setGlobalFlutterSdkPath(value: string): Promise<void> { return this.setConfig("flutterSdkPath", value, ConfigurationTarget.Global); }
	public setOffline(value: boolean | undefined): Promise<void> { return this.setConfig("offline", value, ConfigurationTarget.Global); }
	public setOpenDevTools(value: "never" | "flutter" | "always" | undefined): Promise<void> { return this.setConfig("openDevTools", value, ConfigurationTarget.Global); }
	public setShowInspectorNotificationsForWidgetErrors(value: boolean): Promise<void> { return this.setConfig("showInspectorNotificationsForWidgetErrors", value, ConfigurationTarget.Global); }
	public setSdkPath(value: string | undefined, target: ConfigurationTarget): Promise<void> { return this.setConfig("sdkPath", value, target); }
	public setWarnWhenEditingFilesOutsideWorkspace(value: boolean): Promise<void> { return this.setConfig("warnWhenEditingFilesOutsideWorkspace", value, ConfigurationTarget.Global); }
	public setWarnWhenEditingFilesInPubCache(value: boolean): Promise<void> { return this.setConfig("warnWhenEditingFilesInPubCache", value, ConfigurationTarget.Global); }

	public for(uri?: Uri): ResourceConfig {
		return new ResourceConfig(uri);
	}
}

export class ResourceConfig {
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
	get cliAdditionalArgs(): string[] { return this.getConfig<string[]>("cliAdditionalArgs", []); }
	get completeFunctionCalls(): boolean { return this.getConfig<boolean>("completeFunctionCalls", true); }
	get customDartDapPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("customDartDapPath", null)); }
	get customDevTools(): undefined | CustomDevToolsConfig { return this.getConfig<null | CustomDevToolsConfig>("customDevTools", null); }
	get customFlutterDapPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("customFlutterDapPath", null)); }
	get daemonPort(): undefined | number { return this.getConfig<null | number>("daemonPort", null); }
	get dapLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("dapLogFile", null))); }
	get dartTestLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("dartTestLogFile", null))); }
	get devToolsLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("devToolsLogFile", null))); }
	get doNotFormat(): string[] { return this.getConfig<string[]>("doNotFormat", []); }
	get enableCompletionCommitCharacters(): boolean { return this.getConfig<boolean>("enableCompletionCommitCharacters", false); }
	get evaluateGettersInDebugViews(): boolean { return this.getConfig<boolean>("evaluateGettersInDebugViews", true); }
	get extensionLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("extensionLogFile", null))); }
	get flutterAdditionalArgs(): string[] { return this.getConfig<string[]>("flutterAdditionalArgs", []); }
	get flutterAttachAdditionalArgs(): string[] { return this.getConfig<string[]>("flutterAttachAdditionalArgs", []); }
	get flutterDaemonLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("flutterDaemonLogFile", null))); }
	get flutterRunAdditionalArgs(): string[] { return this.getConfig<string[]>("flutterRunAdditionalArgs", []); }
	get flutterRunLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("flutterRunLogFile", null))); }
	get flutterScreenshotPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("flutterScreenshotPath", null)); }
	get flutterSdkPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("flutterSdkPath", null)); }
	get flutterSdkPaths(): string[] { return this.getConfig<string[]>("flutterSdkPaths", []).map(resolvePaths); }
	get flutterTestAdditionalArgs(): string[] { return this.getConfig<string[]>("flutterTestAdditionalArgs", []); }
	get flutterTestLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("flutterTestLogFile", null))); }
	get flutterTrackWidgetCreation(): boolean { return this.getConfig<boolean>("flutterTrackWidgetCreation", true); }
	get insertArgumentPlaceholders(): boolean { return this.getConfig<boolean>("insertArgumentPlaceholders", true); }
	get lineLength(): number { return this.getConfig<number>("lineLength", 80); }
	get promptToGetPackages(): boolean { return this.getConfig<boolean>("promptToGetPackages", true); }
	get pubAdditionalArgs(): string[] { return this.getConfig<string[]>("pubAdditionalArgs", []); }
	get runPubGetOnPubspecChanges(): "always" | "prompt" | "never" {
		let value = this.getConfig<"always" | "prompt" | "never" | boolean>("runPubGetOnPubspecChanges", "always");
		if (value === true)
			value = "always";
		if (value === false)
			value = "never";
		return value;
	}
	get sdkPath(): undefined | string { return resolvePaths(this.getConfig<null | string>("sdkPath", null)); }
	get sdkPaths(): string[] { return this.getConfig<string[]>("sdkPaths", []).map(resolvePaths); }
	get showDartDeveloperLogs(): boolean { return this.getConfig<boolean>("showDartDeveloperLogs", true); }
	get suppressTestTimeouts(): "never" | "debug" | "always" { return this.getConfig<"never" | "debug" | "always">("suppressTestTimeouts", "never"); }
	get testAdditionalArgs(): string[] { return this.getConfig<string[]>("testAdditionalArgs", []); }
	get vmAdditionalArgs(): string[] { return this.getConfig<string[]>("vmAdditionalArgs", []); }
	get vmServiceLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("vmServiceLogFile", null))); }
	get webDaemonLogFile(): undefined | string { return createFolderForFile(resolvePaths(this.getConfig<null | string>("webDaemonLogFile", null))); }
}

export const config = new Config();
