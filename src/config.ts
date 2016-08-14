"use strict";

import { workspace, WorkspaceConfiguration } from "vscode";

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

	get userDefinedSdkPath() { return this.getConfig<string>("sdkPath"); }
	get lineLength() { return this.getConfig<number>("lineLength"); }
	get setIndentation() { return this.getConfig<number>("setIndentation"); }
	get showTodos() { return this.getConfig<boolean>("showTodos"); }
	get analyzerDiagnosticsPort() { return this.getConfig<number>("analyzerDiagnosticsPort"); }
	get analyzerLogFile() { return this.getConfig<string>("analyzerLogFile"); }
	get allowAnalytics() { return this.getConfig<boolean>("allowAnalytics"); }
}

export const config = new Config();