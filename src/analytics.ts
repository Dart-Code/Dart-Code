"use strict";

import { env, extensions, Extension, workspace, version as codeVersion } from "vscode";
import * as https from "https";
import * as querystring from "querystring";
import { config } from "./config";
import { log, isDevelopment, extensionVersion } from "./utils";

enum EventCategory {
	Extension,
	TODOs
}

enum EventAction {
	Activated,
	SdkDetectionFailure,
	Enabled,
	Disabled
}

class Analytics {
	sdkVersion: string;
	analysisServerVersion: string;

	logActivation() { this.log(EventCategory.Extension, EventAction.Activated); }
	logSdkDetectionFailure() { this.log(EventCategory.Extension, EventAction.SdkDetectionFailure); }
	logShowTodosToggled(enabled: boolean) { this.log(EventCategory.TODOs, enabled ? EventAction.Enabled : EventAction.Disabled); }

	private log(category: EventCategory, action: EventAction) {
		if (!config.allowAnalytics)
			return;

		let data = {
			v: "1", // API Version.
			tid: "UA-2201586-19",
			cid: env.machineId,
			ul: env.language,
			an: "Dart Code",
			av: extensionVersion,
			t: "event",
			ec: EventCategory[category],
			ea: EventAction[action],
			cd1: isDevelopment,
			cd2: process.platform,
			cd3: this.sdkVersion,
			cd4: this.analysisServerVersion,
			cd5: codeVersion
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
