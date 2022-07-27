import * as vs from "vscode";
import { MAX_VERSION } from "../../shared/constants";
import { disposeAll } from "../../shared/utils";
import { WorkspaceContext } from "../../shared/workspace";
import { config } from "../config";
import { isAnalyzable } from "../utils";

export class StatusBarVersionTracker implements vs.Disposable {
	private subscriptions: vs.Disposable[] = [];

	constructor(workspaceContext: WorkspaceContext, isLsp: boolean) {
		const dartIsFromFlutter = workspaceContext.sdks.dartSdkIsFromFlutter;

		// Which switcher we show is based on whether we're in a Flutter project or not.
		const switchSdkCommand = workspaceContext.hasAnyFlutterProjects
			? (config.flutterSdkPaths && config.flutterSdkPaths.length > 0 ? "dart.changeFlutterSdk" : undefined)
			: (config.sdkPaths && config.sdkPaths.length > 0 ? "dart.changeSdk" : undefined);

		// Render an approprite label for what we're calling this SDK.
		const label = workspaceContext.hasAnyFlutterProjects
			? "Flutter"
			: (dartIsFromFlutter ? "Dart from Flutter" : "Dart");

		let versionLabel = (workspaceContext.hasAnyFlutterProjects || dartIsFromFlutter)
			? workspaceContext.sdks.flutterVersion
			: workspaceContext.sdks.dartVersion;

		if (versionLabel === MAX_VERSION)
			versionLabel = "latest";

		if (versionLabel) {
			this.addStatusBarItem(
				`${label}: ` + (versionLabel.length > 20 ? versionLabel.substr(0, 17) + "…" : versionLabel),
				`${label} SDK (${isLsp ? "LSP" : "DAS"}): ${versionLabel}`,
				switchSdkCommand,
			);
		}
	}

	private addStatusBarItem(text: string, tooltip: string, command: string | undefined) {
		const statusBarItem = vs.window.createStatusBarItem("dartStatusSdkVersion", vs.StatusBarAlignment.Right, 2);
		statusBarItem.name = "Dart/Flutter SDK Version";
		statusBarItem.text = text;
		statusBarItem.tooltip = tooltip;
		statusBarItem.command = command;
		this.subscriptions.push(statusBarItem);
		this.subscriptions.push(vs.window.onDidChangeActiveTextEditor((e) => {
			// Show the Dart-specific label if the document is analyzable but it isn't HTML.
			if (e && e.document && isAnalyzable(e.document) && e.document.languageId !== "html")
				statusBarItem.show();
			else
				statusBarItem.hide();
		}));
		if (vs.window.activeTextEditor && vs.window.activeTextEditor.document && isAnalyzable(vs.window.activeTextEditor.document))
			statusBarItem.show();
	}

	public dispose() {
		disposeAll(this.subscriptions);
	}
}
