import * as vs from "vscode";
import { isAnalyzable, ProjectType } from "../utils";
import { config } from "../config";

export class StatusBarVersionTracker implements vs.Disposable {
	private subscriptions: vs.Disposable[] = [];

	constructor(projectType: ProjectType, dartSdkVersion: string, flutterSdkVersion: string) {
		if (projectType === ProjectType.Flutter && flutterSdkVersion) {
			this.addStatusBarItem(
				"Flutter: " + (flutterSdkVersion.length > 20 ? flutterSdkVersion.substr(0, 17) + "…" : flutterSdkVersion),
				`Flutter SDK: ${flutterSdkVersion}`,
				config.flutterSdkPaths && config.flutterSdkPaths.length > 0 ? "dart.changeFlutterSdk" : null,
			);
		}
		if (dartSdkVersion) {
			this.addStatusBarItem(
				"Dart: " + (dartSdkVersion.length > 20 ? dartSdkVersion.substr(0, 17) + "…" : dartSdkVersion),
				`Dart SDK: ${dartSdkVersion}`,
				config.sdkPaths && config.sdkPaths.length > 0 ? "dart.changeSdk" : null,
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
