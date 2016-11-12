"use strict";

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { window, workspace, env, commands, extensions, StatusBarItem, Disposable, TextDocument } from "vscode";
import { Analyzer } from "./analysis/analyzer";
import { ServerStatusNotification, ServerErrorNotification } from "./analysis/analysis_server_types";
import { config } from "./config";
import { dartSdkRoot } from "./extension";
import { getDartSdkVersion } from "./utils";

let tmp = require("tmp");

const maxErrorReportCount = 3;

let errorCount = 0;

// TODO: We should show in the status line when the analysis server's process is dead.

export class AnalyzerStatusReporter extends Disposable {
	private statusBarItem: StatusBarItem;
	private statusShowing: boolean;

	constructor(analyzer: Analyzer) {
		super(() => this.statusBarItem.dispose());

		this.statusBarItem = window.createStatusBarItem();
		this.statusBarItem.text = "Analyzing…";

		analyzer.registerForServerStatus(n => this.handleServerStatus(n));
		analyzer.registerForServerError(e => this.handleServerError(e));
	}

	private handleServerStatus(status: ServerStatusNotification) {
		if (!status.analysis)
			return;

		this.statusShowing = status.analysis.isAnalyzing;

		if (this.statusShowing) {
			// Debounce short analysis times.
			setTimeout(() => {
				if (this.statusShowing)
					this.statusBarItem.show();
			}, 250);
		} else {
			this.statusBarItem.hide();
		}
	}

	private handleServerError(error: ServerErrorNotification) {
		// Always log to the console.
		console.error(error.message);
		if (error.stackTrace)
			console.error(error.stackTrace);

		errorCount++;

		// Offer to report the error.
		if (config.reportAnalyzerErrors && errorCount <= maxErrorReportCount) {
			const shouldReport: string = "Report Exception";
			window.showErrorMessage(`Exception from the Dart analysis server: ${error.message}`, shouldReport).then(res => {
				if (res == shouldReport)
					this.reportError(error);
			});
		}
	}

	private reportError(error: ServerErrorNotification) {
		// TODO: How to get the VSCode version?
		let sdkVersion = getDartSdkVersion(dartSdkRoot);
		let dartCodeVersion = extensions.getExtension('DanTup.dart-code').packageJSON.version;

		let data = `
Please report the following to https://github.com/dart-lang/sdk/issues/new:

Exception from analysis server (running from VSCode)

### what happened

<please describe what you were doing when this exception occurred>

### versions

- SDK ${sdkVersion}
- ${env.appName}
- Dart Code ${dartCodeVersion}

### the exception

${error.message} ${error.isFatal ? ' (fatal)' : ''}

\`\`\`
${error.stackTrace}
\`\`\`
`;

		let tempFile = tmp.fileSync({ prefix: 'bug-', postfix: '.md' });
		fs.writeFileSync(tempFile.name, data, 'utf8');
		workspace.openTextDocument(tempFile.name).then(document => {
			window.showTextDocument(document);
		});
	}
}
