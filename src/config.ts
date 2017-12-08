"use strict";

import { workspace, WorkspaceConfiguration, version as codeVersion, Uri, ConfigurationTarget } from "vscode";
import { versionIsAtLeast, resolveHomePath } from "./utils";

class Config {
	config: WorkspaceConfiguration;

	constructor() {
		workspace.onDidChangeConfiguration(e => this.loadConfig());
		this.loadConfig();
	}

	private loadConfig() {
		this.config = workspace.getConfiguration("dart");
	}

	private getConfig<T>(key: string): T {
		return this.config.get<T>(key);
	}

	private setConfig<T>(key: string, value: T, target: ConfigurationTarget): Thenable<void> {
		return this.config.update(key, value, target).then(() => this.loadConfig());
	}

	get allowAnalytics() { return this.getConfig<boolean>("allowAnalytics"); }
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
	get flutterSdkPath() { return resolveHomePath(this.getConfig<string>("flutterSdkPath")); }
	get showLintNames() { return this.getConfig<boolean>("showLintNames"); }
	get showTodos() { return this.getConfig<boolean>("showTodos"); }
	get reportAnalyzerErrors() { return this.getConfig<boolean>("reportAnalyzerErrors"); }
	get userDefinedSdkPath() { return resolveHomePath(this.getConfig<string>("sdkPath")); }
	setUserDefinedSdkPath(value: string): Thenable<void> { return this.setConfig("sdkPath", value, ConfigurationTarget.Workspace); }
	get sdkPaths() { return (this.getConfig<string[]>("sdkPaths") || []).map(resolveHomePath); }

	// Preview features.
	get previewAnalyzeAngularTemplates() { return this.getConfig<boolean>("previewAnalyzeAngularTemplates"); }

	for(uri: Uri): ResourceConfig {
		return new ResourceConfig(uri);
	}
}

class ResourceConfig {
	uri: Uri;
	config: WorkspaceConfiguration;

	constructor(uri: Uri) {
		this.uri = uri;
		workspace.onDidChangeConfiguration(e => this.loadConfig());
		this.loadConfig();
	}

	private loadConfig() {
		this.config = workspace.getConfiguration("dart", this.uri);
	}

	private getConfig<T>(key: string): T {
		return this.config.get<T>(key);
	}

	get debugSdkLibraries() { return this.getConfig<boolean>("debugSdkLibraries"); }
	get debugExternalLibraries() { return this.getConfig<boolean>("debugExternalLibraries"); }
	get insertArgumentPlaceholders() { return this.getConfig<boolean>("insertArgumentPlaceholders"); }
	get lineLength() { return this.getConfig<number>("lineLength"); }
	get pubAdditionalArgs() { return this.getConfig<string[]>("pubAdditionalArgs"); }
	get runPubGetOnPubspecChanges() { return this.getConfig<boolean>("runPubGetOnPubspecChanges"); }
	get flutterRunLogFile() { return resolveHomePath(this.getConfig<string>("flutterRunLogFile")); }
	get observatoryLogFile() { return resolveHomePath(this.getConfig<string>("observatoryLogFile")); }
}

export class CodeCapabilities {
	version: string;

	constructor(codeVersion: string) {
		this.version = codeVersion;
	}

	get hasScrollableHovers() { return versionIsAtLeast(this.version, "1.6.0"); }
}

export const config = new Config();
export const vsCodeVersion = new CodeCapabilities(codeVersion);
