"use strict";

import { workspace } from "vscode";

class Config {
	private getConfig<T>(key: string): T {
		return workspace.getConfiguration("dart").get<T>(key);
	}

	get userDefinedSdkPath() { return this.getConfig<string>("sdkPath"); }
	get lineLength() { return this.getConfig<number>("lineLength"); }
	get setIndentSettings() { return this.getConfig<number>("setIndentSettings"); }
	get showTodos() { return this.getConfig<boolean>("showTodos"); }
	get analyzerDiagnosticsPort() { return this.getConfig<number>("analyzerDiagnosticsPort"); }
	get verbose() { return this.getConfig<boolean>("verbose"); }
}

export const config = new Config();