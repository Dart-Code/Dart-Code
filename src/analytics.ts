"use strict";

import { env, extensions, Extension, workspace, version as codeVersion, Uri } from "vscode";
import * as https from "https";
import * as querystring from "querystring";
import { config } from "./config";
import { log, isDevelopment, extensionVersion, ProjectType, Sdks } from "./utils";

// Set to true for analytics to be sent to the debug endpoint (non-logging) for validation.
// This is only required for debugging analytics and needn't be sent for standard Dart Code development (dev hits are already filtered with isDevelopment).
const debug = false;

enum Category {
	Extension,
	Analyzer,
	Debugger,
}

enum EventAction {
	Activated,
	SdkDetectionFailure,
	Deactivated,
}

enum TimingVariable {
	Startup,
	FirstAnalysis,
}

export class Analytics {
	public sdks: Sdks;
	public sdkVersion: string;
	public analysisServerVersion: string;

	constructor(sdks: Sdks) {
		this.sdks = sdks;
	}

	public logExtensionStartup(timeInMS: number) {
		this.event(Category.Extension, EventAction.Activated);
		this.time(Category.Extension, TimingVariable.Startup, timeInMS);
	}
	public logExtensionShutdown() { this.event(Category.Extension, EventAction.Deactivated); }
	public logSdkDetectionFailure() { this.event(Category.Extension, EventAction.SdkDetectionFailure); }
	public logAnalyzerError(description: string, fatal: boolean) { this.error("AS: " + description, fatal); }
	public logAnalyzerStartupTime(timeInMS: number) { this.time(Category.Analyzer, TimingVariable.Startup, timeInMS); }
	public logAnalyzerFirstAnalysisTime(timeInMS: number) { this.time(Category.Analyzer, TimingVariable.FirstAnalysis, timeInMS); }
	public logDebuggerStart(resourceUri: Uri) { this.event(Category.Debugger, EventAction.Activated, resourceUri); }

	private event(category: Category, action: EventAction, resourceUri?: Uri) {
		const data: any = {
			ea: EventAction[action],
			ec: Category[category],
			t: "event",
		};

		// Force a session start if this is extension activation.
		if (category === Category.Extension && action === EventAction.Activated)
			data.sc = "start";

		// Force a session end if this is extension deactivation.
		if (category === Category.Extension && action === EventAction.Deactivated)
			data.sc = "end";

		this.send(data, resourceUri);
	}

	private time(category: Category, timingVariable: TimingVariable, timeInMS: number) {
		const data: any = {
			t: "timing",
			utc: Category[category],
			utt: Math.round(timeInMS),
			utv: TimingVariable[timingVariable],
		};

		this.send(data);
	}

	private error(description: string, fatal: boolean) {
		const data: any = {
			exd: description.split(/[\n\{\/\\]/)[0].substring(0, 150).trim(),
			exf: fatal ? 1 : 0,
			t: "exception",
		};

		this.send(data);
	}

	private send(customData: any, resourceUri?: Uri) {
		if (!config.allowAnalytics)
			return;

		const data: any = {
			an: "Dart Code",
			av: extensionVersion,
			cd1: isDevelopment,
			cd10: config.showTodos ? "On" : "Off",
			cd11: config.showLintNames ? "On" : "Off",
			cd2: process.platform,
			cd3: this.sdkVersion,
			cd4: this.analysisServerVersion,
			cd5: codeVersion,
			cd6: this.getDebuggerPreference(resourceUri),
			cd7: ProjectType[this.sdks.projectType],
			cd8: config.closingLabels ? "On" : "Off",
			cd9: this.sdks.projectType === ProjectType.Flutter ? (config.flutterHotReloadOnSave ? "On" : "Off") : null,
			cid: env.machineId,
			tid: "UA-2201586-19",
			ul: env.language,
			v: "1", // API Version.
		};

		// Copy custom data over.
		Object.assign(data, customData);

		if (debug)
			console.log("Sending analytic: " + JSON.stringify(data));

		const options: https.RequestOptions = {
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			hostname: "www.google-analytics.com",
			method: "POST",
			path: debug ? "/debug/collect" : "/collect",
			port: 443,
		};

		const req = https.request(options, (resp) => {
			if (debug)
				resp.on("data", (c) => {
					try {
						const gaDebugResp = JSON.parse(c.toString());
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
