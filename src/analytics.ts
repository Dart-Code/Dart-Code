"use strict";

import { env, extensions, Extension, workspace, version as codeVersion } from "vscode";
import * as https from "https";
import * as querystring from "querystring";
import { config } from "./config";
import { log, isDevelopment, extensionVersion } from "./utils";

enum Category {
	Extension,
	TODOs,
	Analyzer,
	Debugger
}

enum EventAction {
	Activated,
	SdkDetectionFailure,
	Enabled,
	Disabled,
	Error,
	FatalError
}

enum TimingVariable {
	Startup,
	FirstAnalysis
}

class Analytics {
	sdkVersion: string;
	analysisServerVersion: string;

	logExtensionStartup(timeInMS: number) {
		this.log(Category.Extension, EventAction.Activated);
		this.time(Category.Extension, TimingVariable.Startup, timeInMS);
	};
	logSdkDetectionFailure() { this.log(Category.Extension, EventAction.SdkDetectionFailure); }
	logShowTodosToggled(enabled: boolean) { this.log(Category.TODOs, enabled ? EventAction.Enabled : EventAction.Disabled); }
	logAnalyzerError(fatal: boolean) { this.log(Category.Analyzer, fatal ? EventAction.FatalError : EventAction.Error); }
	logAnalyzerStartupTime(timeInMS: number) { this.time(Category.Analyzer, TimingVariable.Startup, timeInMS); }
	logAnalyzerFirstAnalysisTime(timeInMS: number) { this.time(Category.Analyzer, TimingVariable.FirstAnalysis, timeInMS); }
	logDebuggerStart() { this.log(Category.Debugger, EventAction.Activated); }

	private log(category: Category, action: EventAction) {
		this.send(category, action);
	}

	private time(category: Category, timingVariable: TimingVariable, timeInMS: number) {
		this.send(category, null, timingVariable, timeInMS);
	}

	private send(category: Category, action?: EventAction, timingVariable?: TimingVariable, timeInMS?: number) {
		//console.log('Sending analytics: ' + Category[category] + ', ' + EventAction[action] + ', ' + TimingVariable[timingVariable] + ', ' + timeInMS);

		if (!config.allowAnalytics)
			return;

		let isEvent = action != undefined;
		let isTiming = timingVariable != undefined;
		let logType = isEvent ? "event" : "timing";
		let isSessionStart = category == Category.Extension && action == EventAction.Activated;
		let isDebuggerStart = category == Category.Debugger && action == EventAction.Activated;

		let debugPreference = "My code";
		if (config.debugSdkLibraries && config.debugExternalLibraries)
			debugPreference = "All code";
		else if (config.debugSdkLibraries)
			debugPreference = "My code + SDK";
		else if (config.debugExternalLibraries)
			debugPreference = "My code + Libraries";

		let data: any = {
			v: "1", // API Version.
			tid: "UA-2201586-19",
			cid: env.machineId,
			ul: env.language,
			an: "Dart Code",
			av: extensionVersion,
			t: logType,
			ec: isEvent ? Category[category] : undefined,
			ea: isEvent ? EventAction[action] : undefined,
			utc: isTiming ? Category[category] : undefined,
			utv: isTiming ? TimingVariable[timingVariable] : undefined,
			utt: isTiming ? Math.round(timeInMS) : undefined,
			cd1: isDevelopment,
			cd2: process.platform,
			cd3: this.sdkVersion,
			cd4: this.analysisServerVersion,
			cd5: codeVersion,
			cd6: isDebuggerStart ? debugPreference : undefined
		};

		if (isEvent && isSessionStart)
			data.sc = "start";

		let debug = false;
		const options: https.RequestOptions = {
			hostname: "www.google-analytics.com",
			port: 443,
			path: debug ? "/debug/collect" : "/collect",
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded"
			}
		};

		let req = https.request(options, resp => {
			if (debug)
				resp.on("data", c => console.log('GA-DEBUG: ' + c));

			if (resp.statusCode < 200 || resp.statusCode > 300) {
				log(`Failed to send analytics ${resp.statusCode}: ${resp.statusMessage}`);
			}
		});
		req.write(querystring.stringify(data));
		req.end();
	}
}

export let analytics = new Analytics();
