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
		console.log(`Loaded config! verbose = ${this.getConfig("verbose")}`);
	}

	private getConfig<T>(key: string): T {
		return this.config.get<T>(key);
	}

	get userDefinedSdkPath() { return this.getConfig<string>("sdkPath"); }
	get lineLength() { return this.getConfig<number>("lineLength"); }
	get setIndentSettings() { return this.getConfig<number>("setIndentSettings"); }
	get showTodos() { return this.getConfig<boolean>("showTodos"); }
	get analyzerDiagnosticsPort() { return this.getConfig<number>("analyzerDiagnosticsPort"); }
	get verbose() { return this.getConfig<boolean>("verbose"); }
}

export const config = new Config();