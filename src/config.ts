"use strict";

import { workspace, WorkspaceConfiguration, version as codeVersion, Uri } from "vscode";
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

	private setConfig<T>(key: string, value: T): Thenable<void> {
		return this.config.update(key, value, true).then(() => this.loadConfig());
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
	get debugSdkLibraries() { return this.getConfig<boolean>("debugSdkLibraries"); }
	setDebugSdkLibraries(value: boolean): Thenable<void> { return this.setConfig("debugSdkLibraries", value); }
	get debugExternalLibraries() { return this.getConfig<boolean>("debugExternalLibraries"); }
	setDebugExternalLibraries(value: boolean): Thenable<void> { return this.setConfig("debugExternalLibraries", value); }
	get flutterDaemonLogFile() { return resolveHomePath(this.getConfig<string>("flutterDaemonLogFile")); }
	get flutterHotReloadOnSave() { return this.getConfig<boolean>("flutterHotReloadOnSave"); }
	get flutterRunLogFile() { return resolveHomePath(this.getConfig<string>("flutterRunLogFile")); }
	get flutterSdkPath() { return resolveHomePath(this.getConfig<string>("flutterSdkPath")); }
	get observatoryLogFile() { return resolveHomePath(this.getConfig<string>("observatoryLogFile")); }
	get showLintNames() { return this.getConfig<boolean>("showLintNames"); }
	get showTodos() { return this.getConfig<boolean>("showTodos"); }
	get reportAnalyzerErrors() { return this.getConfig<boolean>("reportAnalyzerErrors"); }
	get userDefinedSdkPath() { return resolveHomePath(this.getConfig<string>("sdkPath")); }
	setUserDefinedSdkPath(value: string): Thenable<void> { return this.setConfig("sdkPath", value); }
	get sdkContainer() { return resolveHomePath(this.getConfig<string>("sdkContainer")); }

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

	get insertArgumentPlaceholders() { return this.getConfig<boolean>("insertArgumentPlaceholders"); }
	get lineLength() { return this.getConfig<number>("lineLength"); }
	get pubAdditionalArgs() { return this.getConfig<string[]>("pubAdditionalArgs"); }
	get runPubGetOnPubspecChanges() { return this.getConfig<boolean>("runPubGetOnPubspecChanges"); }
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
