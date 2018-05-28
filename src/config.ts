import { ConfigurationTarget, Uri, WorkspaceConfiguration, workspace } from "vscode";
import { resolveHomePath } from "./utils";

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
	get analyzerLogFile() { return resolveHomePath(this.getConfig<string>("analyzerLogFile")); }
	get analyzerPath() { return resolveHomePath(this.getConfig<string>("analyzerPath")); }
	get analyzerInstrumentationLogFile() { return resolveHomePath(this.getConfig<string>("analyzerInstrumentationLogFile")); }
	get analyzerAdditionalArgs() { return this.getConfig<string[]>("analyzerAdditionalArgs"); }
	get checkForSdkUpdates() { return this.getConfig<boolean>("checkForSdkUpdates"); }
	get closingLabels() { return this.getConfig<boolean>("closingLabels"); }
	get flutterDaemonLogFile() { return resolveHomePath(this.getConfig<string>("flutterDaemonLogFile")); }
	get flutterHotReloadOnSave() { return this.getConfig<boolean>("flutterHotReloadOnSave"); }
	get flutterCreateOrganization() { return this.getConfig<string>("flutterCreateOrganization"); }
	get flutterCreateIOSLanguage() { return this.getConfig<string>("flutterCreateIOSLanguage"); }
	get flutterCreateAndroidLanguage() { return this.getConfig<string>("flutterCreateAndroidLanguage"); }
	get flutterSdkPath() { return resolveHomePath(this.getConfig<string>("flutterSdkPath")); }
	public setFlutterSdkPath(value: string): Thenable<void> { return this.setConfig("flutterSdkPath", value, ConfigurationTarget.Workspace); }
	get flutterSdkPaths() { return (this.getConfig<string[]>("flutterSdkPaths") || []).map(resolveHomePath); }
	get showLintNames() { return this.getConfig<boolean>("showLintNames"); }
	get showTodos() { return this.getConfig<boolean>("showTodos"); }
	get reportAnalyzerErrors() { return this.getConfig<boolean>("reportAnalyzerErrors"); }
	get sdkPath() { return resolveHomePath(this.getConfig<string>("sdkPath")); }
	public setSdkPath(value: string): Thenable<void> { return this.setConfig("sdkPath", value, ConfigurationTarget.Workspace); }
	get sdkPaths() { return (this.getConfig<string[]>("sdkPaths") || []).map(resolveHomePath); }
	get flutterSelectDeviceWhenConnected() { return this.getConfig<boolean>("flutterSelectDeviceWhenConnected"); }

	public setGlobalDartSdkPath(value: string): Thenable<void> { return this.setConfig("sdkPath", value, ConfigurationTarget.Global); }
	public setGlobalFlutterSdkPath(value: string): Thenable<void> { return this.setConfig("flutterSdkPath", value, ConfigurationTarget.Global); }

	// Preview features.
	get normaliseWindowsDriveLetters() { return this.getConfig<boolean>("normaliseWindowsDriveLetters"); }

	public for(uri?: Uri): ResourceConfig {
		return new ResourceConfig(uri);
	}
}

class ResourceConfig {
	public uri: Uri;
	public config: WorkspaceConfiguration;

	constructor(uri: Uri) {
		this.uri = uri;
		workspace.onDidChangeConfiguration((e) => this.loadConfig());
		this.loadConfig();
	}

	private loadConfig() {
		this.config = workspace.getConfiguration("dart", this.uri);
	}

	private getConfig<T>(key: string): T {
		return this.config.get<T>(key);
	}

	private setConfig<T>(key: string, value: T, target: ConfigurationTarget): Thenable<void> {
		return this.config.update(key, value, target).then(() => this.loadConfig());
	}

	get debugSdkLibraries() { return this.getConfig<boolean>("debugSdkLibraries"); }
	get debugExternalLibraries() { return this.getConfig<boolean>("debugExternalLibraries"); }
	get insertArgumentPlaceholders() { return this.getConfig<boolean>("insertArgumentPlaceholders"); }
	get lineLength() { return this.getConfig<number>("lineLength"); }
	get pubAdditionalArgs() { return this.getConfig<string[]>("pubAdditionalArgs"); }
	get runPubGetOnPubspecChanges() { return this.getConfig<boolean>("runPubGetOnPubspecChanges"); }
	get flutterRunLogFile() { return resolveHomePath(this.getConfig<string>("flutterRunLogFile")); }
	get flutterTestLogFile() { return resolveHomePath(this.getConfig<string>("flutterTestLogFile")); }
	get observatoryLogFile() { return resolveHomePath(this.getConfig<string>("observatoryLogFile")); }
	get promptToGetPackages() { return this.getConfig<boolean>("promptToGetPackages"); }
	get vmAdditionalArgs() { return this.getConfig<string[]>("vmAdditionalArgs"); }
}

export const config = new Config();
