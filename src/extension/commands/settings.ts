import * as vs from "vscode";
import { Logger } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { WorkspaceContext } from "../../shared/workspace";

export class SettingsCommands implements vs.Disposable {
	private disposables: vs.Disposable[] = [];

	constructor(protected readonly logger: Logger, protected readonly wsContext: WorkspaceContext) {
		this.disposables.push(vs.commands.registerCommand("_dart.settings.openDartTestAdditionalArgs", () => this.openSettings("dart.testAdditionalArgs")));
		this.disposables.push(vs.commands.registerCommand("_dart.settings.openFlutterTestAdditionalArgs", () => this.openSettings("dart.flutterTestAdditionalArgs")));
	}

	private async openSettings(settingName: string): Promise<void> {
		await vs.commands.executeCommand("workbench.action.openSettings2", {
			query: settingName,
			// https://github.com/microsoft/vscode/issues/226071
			// target: vs.ConfigurationTarget.Workspace,
		});
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
