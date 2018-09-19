import * as vs from "vscode";
import { config } from "../config";
import { isAnalyzable, ProjectType } from "../utils";

export class StatusBarVersionTracker implements vs.Disposable {
	private subscriptions: vs.Disposable[] = [];

	constructor(projectType: ProjectType, dartSdkVersion: string, flutterSdkVersion: string, isDartSdkFromFlutter: boolean) {
		// Which switcher we show is based on whether we're in a Flutter project or not.
		const switchSdkCommand = projectType === ProjectType.Flutter
			? (config.flutterSdkPaths && config.flutterSdkPaths.length > 0 ? "dart.changeFlutterSdk" : null)
			: (config.sdkPaths && config.sdkPaths.length > 0 ? "dart.changeSdk" : null);

		// Render an approprite label for what we're calling this SDK.
		const label = projectType === ProjectType.Flutter
			? "Flutter"
			: (isDartSdkFromFlutter ? "Dart from Flutter" : "Dart");

		const versionLabel = (projectType === ProjectType.Flutter || isDartSdkFromFlutter)
			? flutterSdkVersion
			: dartSdkVersion;

		if (versionLabel) {
			this.addStatusBarItem(
				`${label}: ` + (versionLabel.length > 20 ? versionLabel.substr(0, 17) + "…" : versionLabel),
				`${label} SDK: ${versionLabel}`,
				switchSdkCommand,
			);
		}
	}

	private addStatusBarItem(text: string, tooltip: string, command: string) {
		const statusBarItem = vs.window.createStatusBarItem(vs.StatusBarAlignment.Right, 2);
		statusBarItem.text = text;
		statusBarItem.tooltip = tooltip;
		statusBarItem.command = command;
		this.subscriptions.push(statusBarItem);
		this.subscriptions.push(vs.window.onDidChangeActiveTextEditor((e) => {
			if (e && e.document && isAnalyzable(e.document))
				statusBarItem.show();
			else
				statusBarItem.hide();
		}));
		if (vs.window.activeTextEditor && vs.window.activeTextEditor.document && isAnalyzable(vs.window.activeTextEditor.document))
			statusBarItem.show();
	}

	public dispose() {
		this.subscriptions.forEach((s) => s.dispose());
	}
}
