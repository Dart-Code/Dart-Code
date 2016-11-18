"use strict";

import { env, extensions, Extension, workspace, version as codeVersion } from "vscode";
import * as https from "https";
import * as querystring from "querystring";
import { config } from "./config";
import { log, isDevelopment, extensionVersion } from "./utils";

enum Category {
	Extension,
	TODOs,
	Analyzer
}

enum EventAction {
	Activated,
	SdkDetectionFailure,
	Enabled,
	Disabled,
	Error,
	FatalError
}

class Analytics {
	sdkVersion: string;
	analysisServerVersion: string;

	logActivation(timeInMS: number) { this.log(Category.Extension, EventAction.Activated); }
	logSdkDetectionFailure() { this.log(Category.Extension, EventAction.SdkDetectionFailure); }
	logShowTodosToggled(enabled: boolean) { this.log(Category.TODOs, enabled ? EventAction.Enabled : EventAction.Disabled); }
	logAnalyzerError(fatal: boolean) { this.log(Category.Analyzer, fatal ? EventAction.FatalError : EventAction.Error); }

	private log(category: Category, action: EventAction) {
		if (!config.allowAnalytics)
			return;

		let isSessionStart = category == Category.Extension && action == EventAction.Activated;

		let debugPreference = "My code";
		if (config.debugSdkLibraries && config.debugExternalLibraries)
			debugPreference = "All code";
		else if (config.debugSdkLibraries)
			debugPreference = "My code + SDK";
		else if (config.debugExternalLibraries)
			debugPreference = "My code + Libraries";

		let data = {
			v: "1", // API Version.
			tid: "UA-2201586-19",
			cid: env.machineId,
			ul: env.language,
			an: "Dart Code",
			av: extensionVersion,
			t: "event",
			sc: isSessionStart ? "start" : "",
			ec: Category[category],
			ea: EventAction[action],
			cd1: isDevelopment,
			cd2: process.platform,
			cd3: this.sdkVersion,
			cd4: this.analysisServerVersion,
			cd5: codeVersion,
			cd6: debugPreference
		};

		const options: https.RequestOptions = {
			hostname: "www.google-analytics.com",
			port: 443,
			path: "/collect",
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded"
			}
		};

		let req = https.request(options, resp => {
			if (resp.statusCode < 200 || resp.statusCode > 300) {
				log(`Failed to send analytics ${resp.statusCode}: ${resp.statusMessage}`);
			}
		});
		req.write(querystring.stringify(data));
		req.end();
	}
}

export let analytics = new Analytics();
