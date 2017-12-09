"use strict";

import { env, extensions, Extension, workspace, version as codeVersion, Uri } from "vscode";
import * as https from "https";
import * as querystring from "querystring";
import { config } from "./config";
import { log, isDevelopment, extensionVersion, ProjectType, Sdks } from "./utils";

// Set to true for analytics to be sent to the debug endpoint (non-logging) for validation.
// This is only required for debugging analytics and needn't be sent for standard Dart Code development (dev hits are already filtered with isDevelopment).
let debug = false;

enum Category {
	Extension,
	Analyzer,
	Debugger
}

enum EventAction {
	Activated,
	SdkDetectionFailure
}

enum TimingVariable {
	Startup,
	FirstAnalysis
}

export class Analytics {
	sdks: Sdks;
	sdkVersion: string;
	analysisServerVersion: string;

	constructor(sdks: Sdks) {
		this.sdks = sdks;
	}

	logExtensionStartup(timeInMS: number) {
		this.event(Category.Extension, EventAction.Activated);
		this.time(Category.Extension, TimingVariable.Startup, timeInMS);
	};
	logSdkDetectionFailure() { this.event(Category.Extension, EventAction.SdkDetectionFailure); }
	logAnalyzerError(description: string, fatal: boolean) { this.error("AS: " + description, fatal); }
	logAnalyzerStartupTime(timeInMS: number) { this.time(Category.Analyzer, TimingVariable.Startup, timeInMS); }
	logAnalyzerFirstAnalysisTime(timeInMS: number) { this.time(Category.Analyzer, TimingVariable.FirstAnalysis, timeInMS); }
	logDebuggerStart(resourceUri: Uri) { this.event(Category.Debugger, EventAction.Activated, resourceUri); }

	private event(category: Category, action: EventAction, resourceUri?: Uri) {
		let data: any = {
			t: "event",
			ec: Category[category],
			ea: EventAction[action],
		};

		// Force a session start if this is extension activation.		
		if (category == Category.Extension && action == EventAction.Activated)
			data.sc = "start";

		// Include additional project/setting info.
		data.cd7 = ProjectType[this.sdks.projectType];
		data.cd8 = config.closingLabels ? "On" : "Off";
		if (this.sdks.projectType == ProjectType.Flutter)
			data.cd9 = config.flutterHotReloadOnSave ? "On" : "Off";
		data.cd10 = config.showTodos ? "On" : "Off";
		data.cd11 = config.showLintNames ? "On" : "Off";

		// Include debug preference if it's a debugger start.
		if (category == Category.Debugger && action == EventAction.Activated)
			data.cd6 = this.getDebuggerPreference(resourceUri);

		this.send(data);
	}

	private time(category: Category, timingVariable: TimingVariable, timeInMS: number) {
		let data: any = {
			t: "timing",
			utc: Category[category],
			utv: TimingVariable[timingVariable],
			utt: Math.round(timeInMS)
		};

		this.send(data);
	}

	private error(description: string, fatal: boolean) {
		let data: any = {
			t: "exception",
			exd: description.split(/[\n\{\/\\]/)[0].substring(0, 150).trim(),
			exf: fatal ? 1 : 0
		};

		this.send(data);
	}

	private send(customData: any) {
		if (!config.allowAnalytics)
			return;

		let data: any = {
			v: "1", // API Version.
			tid: "UA-2201586-19",
			cid: env.machineId,
			ul: env.language,
			an: "Dart Code",
			av: extensionVersion,
			cd1: isDevelopment,
			cd2: process.platform,
			cd3: this.sdkVersion,
			cd4: this.analysisServerVersion,
			cd5: codeVersion,
		};

		// Copy custom data over.		
		Object.assign(data, customData);

		if (debug)
			console.log("Sending analytic: " + JSON.stringify(data));

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
				resp.on("data", c => {
					try {
						var gaDebugResp = JSON.parse(c.toString());
						if (gaDebugResp && gaDebugResp.hitParsingResult && gaDebugResp.hitParsingResult[0].valid === true)
							console.log("Sent OK!");
						else if (gaDebugResp && gaDebugResp.hitParsingResult && gaDebugResp.hitParsingResult[0].valid === false)
							console.warn(c.toString());
						else
							console.warn("Unexpected GA debug response: " + c.toString());
					} catch (e) {
						console.warn("Error in GA debug response: " + c.toString());
					}
				});

			if (resp.statusCode < 200 || resp.statusCode > 300) {
				log(`Failed to send analytics ${resp.statusCode}: ${resp.statusMessage}`);
			}
		});
		req.write(querystring.stringify(data));
		req.end();
	}

	private getDebuggerPreference(resourceUri: Uri): string {
		const conf = config.for(resourceUri);
		if (conf.debugSdkLibraries && conf.debugExternalLibraries)
			return "All code";
		else if (conf.debugSdkLibraries)
			return "My code + SDK";
		else if (conf.debugExternalLibraries)
			return "My code + Libraries";
		else
			return "My code";
	}
}
