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

	get allowAnalytics() { return this.getConfig<boolean>("allowAnalytics"); }
	get analyzerDiagnosticsPort() { return this.getConfig<number>("analyzerDiagnosticsPort"); }
	get analyzerObservatoryPort() { return this.getConfig<number>("analyzerObservatoryPort"); }
	get analyzerLogFile() { return this.getConfig<string>("analyzerLogFile"); }
	get checkForSdkUpdates() { return this.getConfig<boolean>("checkForSdkUpdates"); }
	get debugSdkLibraries() { return this.getConfig<boolean>("debugSdkLibraries"); }
	get debugExternalLibraries() { return this.getConfig<boolean>("debugExternalLibraries"); }
	get insertArgumentPlaceholders() { return this.getConfig<boolean>("insertArgumentPlaceholders"); }
	get lineLength() { return this.getConfig<number>("lineLength"); }
	get runPubGetOnPubspecChanges() { return this.getConfig<boolean>("runPubGetOnPubspecChanges"); }
	get setIndentation() { return this.getConfig<number>("setIndentation"); }
	get showTodos() { return this.getConfig<boolean>("showTodos"); }
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
