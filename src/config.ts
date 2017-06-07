"use strict";

import { workspace, WorkspaceConfiguration, version as codeVersion } from "vscode";

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
	get analyzerLogFile() { return this.getConfig<string>("analyzerLogFile"); }
	get analyzerPath() { return this.getConfig<string>("analyzerPath"); }
	get analyzerInstrumentationLogFile() { return this.getConfig<string>("analyzerInstrumentationLogFile"); }
	get analyzerAdditionalArgs() { return this.getConfig<string[]>("analyzerAdditionalArgs"); }
	get checkForSdkUpdates() { return this.getConfig<boolean>("checkForSdkUpdates"); }
	get debugSdkLibraries() { return this.getConfig<boolean>("debugSdkLibraries"); }
	setDebugSdkLibraries(value: boolean): Thenable<void> { return this.setConfig("debugSdkLibraries", value); }
	get debugExternalLibraries() { return this.getConfig<boolean>("debugExternalLibraries"); }
	setDebugExternalLibraries(value: boolean): Thenable<void> { return this.setConfig("debugExternalLibraries", value); }
	get insertArgumentPlaceholders() { return this.getConfig<boolean>("insertArgumentPlaceholders"); }
	get lineLength() { return this.getConfig<number>("lineLength"); }
	get pubAdditionalArgs() { return this.getConfig<string[]>("pubAdditionalArgs"); }
	get runPubGetOnPubspecChanges() { return this.getConfig<boolean>("runPubGetOnPubspecChanges"); }
	get showTodos() { return this.getConfig<boolean>("showTodos"); }
	get reportAnalyzerErrors() { return this.getConfig<boolean>("reportAnalyzerErrors"); }
	get userDefinedSdkPath() { return this.getConfig<string>("sdkPath"); }
}

export class CodeCapabilities {
	version: number;

	constructor(codeVersion: string) {
		this.version = parseFloat(codeVersion.split('.').slice(0, 2).join('.'));
	}

	get hasScrollableHovers() { return this.version >= 1.6; }
}

export const config = new Config();
export const vsCodeVersion = new CodeCapabilities(codeVersion);
