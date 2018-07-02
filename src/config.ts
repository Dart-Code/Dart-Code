import { ConfigurationTarget, Uri, workspace, WorkspaceConfiguration } from "vscode";
import { createFolderIfRequired, resolvePaths } from "./utils";

class Config {
	private config: WorkspaceConfiguration;

	constructor() {
		workspace.onDidChangeConfiguration((e) => this.loadConfig());
		this.loadConfig();
	}

	private loadConfig() {
		this.config = workspace.getConfiguration("dart");
	}

	private getConfig<T>(key: string): T {
		return this.config.get<T>(key);
	}

	private async setConfig<T>(key: string, value: T, target: ConfigurationTarget): Promise<void> {
		await this.config.update(key, value, target);
		this.loadConfig();
	}

	get allowAnalytics() { return this.getConfig<boolean>("allowAnalytics"); }
	get analyzeAngularTemplates() { return this.getConfig<boolean>("analyzeAngularTemplates"); }
	get analyzerDiagnosticsPort() { return this.getConfig<number>("analyzerDiagnosticsPort"); }
	get analyzerObservatoryPort() { return this.getConfig<number>("analyzerObservatoryPort"); }
	get analyzerLogFile() { return createFolderIfRequired(resolvePaths(this.getConfig<string>("analyzerLogFile"))); }
	get analyzerPath() { return resolvePaths(this.getConfig<string>("analyzerPath")); }
	get analysisServerFolding() { return this.getConfig<boolean>("analysisServerFolding"); }
	get analyzerInstrumentationLogFile() { return createFolderIfRequired(resolvePaths(this.getConfig<string>("analyzerInstrumentationLogFile"))); }
	get analyzerAdditionalArgs() { return this.getConfig<string[]>("analyzerAdditionalArgs"); }
	get analyzerSshHost() { return this.getConfig<string>("analyzerSshHost"); }
	get checkForSdkUpdates() { return this.getConfig<boolean>("checkForSdkUpdates"); }
	get closingLabels() { return this.getConfig<boolean>("closingLabels"); }
	get flutterDaemonLogFile() { return createFolderIfRequired(resolvePaths(this.getConfig<string>("flutterDaemonLogFile"))); }
	get extensionLogFile() { return createFolderIfRequired(resolvePaths(this.getConfig<string>("extensionLogFile"))); }
	get flutterHotReloadOnSave() { return this.getConfig<boolean>("flutterHotReloadOnSave"); }
	get flutterCreateOrganization() { return this.getConfig<string>("flutterCreateOrganization"); }
	get flutterCreateIOSLanguage() { return this.getConfig<string>("flutterCreateIOSLanguage"); }
	get flutterCreateAndroidLanguage() { return this.getConfig<string>("flutterCreateAndroidLanguage"); }
	get flutterSdkPath() { return resolvePaths(this.getConfig<string>("flutterSdkPath")); }
	public setFlutterSdkPath(value: string): Thenable<void> { return this.setConfig("flutterSdkPath", value, ConfigurationTarget.Workspace); }
	get flutterSdkPaths() { return (this.getConfig<string[]>("flutterSdkPaths") || []).map(resolvePaths); }
	get showLintNames() { return this.getConfig<boolean>("showLintNames"); }
	get showTodos() { return this.getConfig<boolean>("showTodos"); }
	get reportAnalyzerErrors() { return this.getConfig<boolean>("reportAnalyzerErrors"); }
	get sdkPath() { return resolvePaths(this.getConfig<string>("sdkPath")); }
	public setSdkPath(value: string): Thenable<void> { return this.setConfig("sdkPath", value, ConfigurationTarget.Workspace); }
	get sdkPaths() { return (this.getConfig<string[]>("sdkPaths") || []).map(resolvePaths); }
	get flutterSelectDeviceWhenConnected() { return this.getConfig<boolean>("flutterSelectDeviceWhenConnected"); }

	public setGlobalDartSdkPath(value: string): Thenable<void> { return this.setConfig("sdkPath", value, ConfigurationTarget.Global); }
	public setGlobalFlutterSdkPath(value: string): Thenable<void> { return this.setConfig("flutterSdkPath", value, ConfigurationTarget.Global); }

	// Preview features.
	get normalizeWindowsDriveLetters() { return this.getConfig<boolean>("normalizeWindowsDriveLetters"); }
	get previewTestRunnerForDart() { return this.getConfig<boolean>("previewTestRunnerForDart"); }
	get previewHotReloadCoverageMarkers() { return this.getConfig<boolean>("previewHotReloadCoverageMarkers"); }

	public for(uri?: Uri): ResourceConfig {
		return new ResourceConfig(uri);
	}
}

class ResourceConfig {
	public uri: Uri;
	public config: WorkspaceConfiguration;

	constructor(uri: Uri) {
		this.uri = uri;
		this.config = workspace.getConfiguration("dart", this.uri);
	}

	private getConfig<T>(key: string): T {
		return this.config.get<T>(key);
	}

	get debugSdkLibraries() { return this.getConfig<boolean>("debugSdkLibraries"); }
	get debugExternalLibraries() { return this.getConfig<boolean>("debugExternalLibraries"); }
	get evaluateGettersInDebugViews() { return this.getConfig<boolean>("evaluateGettersInDebugViews"); }
	get insertArgumentPlaceholders() { return this.getConfig<boolean>("insertArgumentPlaceholders"); }
	get lineLength() { return this.getConfig<number>("lineLength"); }
	get pubAdditionalArgs() { return this.getConfig<string[]>("pubAdditionalArgs"); }
	get runPubGetOnPubspecChanges() { return this.getConfig<boolean>("runPubGetOnPubspecChanges"); }
	get flutterRunLogFile() { return createFolderIfRequired(resolvePaths(this.getConfig<string>("flutterRunLogFile"))); }
	get flutterTestLogFile() { return createFolderIfRequired(resolvePaths(this.getConfig<string>("flutterTestLogFile"))); }
	get observatoryLogFile() { return createFolderIfRequired(resolvePaths(this.getConfig<string>("observatoryLogFile"))); }
	get pubTestLogFile() { return createFolderIfRequired(resolvePaths(this.getConfig<string>("pubTestLogFile"))); }
	get promptToGetPackages() { return this.getConfig<boolean>("promptToGetPackages"); }
	get vmAdditionalArgs() { return this.getConfig<string[]>("vmAdditionalArgs"); }
}

export const config = new Config();
