import * as vs from "vscode";
import { MAX_VERSION } from "../../shared/constants";
import { disposeAll } from "../../shared/utils";
import { ANALYSIS_FILTERS } from "../../shared/vscode/constants";
import { getLanguageStatusItem } from "../../shared/vscode/status_bar";
import { WorkspaceContext } from "../../shared/workspace";
import { config } from "../config";

export class StatusBarVersionTracker implements vs.Disposable {
	private disposables: vs.Disposable[] = [];

	constructor(workspaceContext: WorkspaceContext, isLsp: boolean) {
		const isFlutter = workspaceContext.hasAnyFlutterProjects;
		const dartIsFromFlutter = workspaceContext.sdks.dartSdkIsFromFlutter;

		const canChangeFlutterSdk = config.flutterSdkPaths && config.flutterSdkPaths.length > 0;
		const canChangeDartSdk = !isFlutter && config.sdkPaths && config.sdkPaths.length > 0;

		const flutterVersion = this.versionOrLatest(workspaceContext.sdks.flutterVersion);
		let dartVersion = this.versionOrLatest(workspaceContext.sdks.dartVersion);

		if (dartIsFromFlutter)
			dartVersion = `${dartVersion} (Flutter)`;

		if (dartVersion) {
			this.addStatusBarItem(
				"dart.sdkVersion",
				"Dart",
				dartVersion,
				canChangeDartSdk ? "dart.changeSdk" : undefined,
			);
		}
		if (isFlutter && flutterVersion) {
			this.addStatusBarItem(
				"dart.flutterSdkVersion",
				"Flutter",
				flutterVersion,
				canChangeFlutterSdk ? "dart.changeFlutterSdk" : undefined,
			);
		}
	}

	private versionOrLatest(version: string | undefined): string | undefined {
		return version === MAX_VERSION ? "latest" : version;
	}

	private addStatusBarItem(id: string, kind: string, versionNumber: string, command: string | undefined) {
		const statusBarItem = getLanguageStatusItem(id, ANALYSIS_FILTERS);
		statusBarItem.text = versionNumber;
		statusBarItem.detail = `${kind} SDK`;
		statusBarItem.name = `${kind} SDK`;
		if (command) {
			statusBarItem.command = {
				command,
				title: "change",
			};
		}
	}

	public dispose() {
		disposeAll(this.disposables);
	}
}
