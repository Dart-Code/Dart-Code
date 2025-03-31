import { ConfigurationChangeEvent, workspace } from "vscode";
import { ClientCapabilities, FeatureState, RequestType, StaticFeature } from "vscode-languageclient";
import { LanguageClient } from "vscode-languageclient/node";
import { IAmDisposable, Logger } from "../interfaces";
import { disposeAll } from "../utils";
import { hostKind } from "./utils";

const interestingSettings: { [key: string]: string[] } = {
	dart: [
		"onlyAnalyzeProjectsWithOpenFiles",
	],
	editor: [
		"formatOnSave",
		"formatOnPaste",
		"formatOnType",
		"codeActionsOnSave",
	],
};

export class AnalyzerUpdateDiagnosticInformationFeature implements IAmDisposable {
	private disposables: IAmDisposable[] = [];
	private isSupported = false;

	constructor(private readonly logger: Logger, private readonly client: LanguageClient) {
		this.disposables.push(workspace.onDidChangeConfiguration((e) => this.updateDiagnosticInformationIfRelevantConfigChanged(e)));
	}

	public get feature(): StaticFeature {
		const disposables = this.disposables;
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const that = this;
		return {
			dispose() {
				disposeAll(disposables);
			},
			fillClientCapabilities(capabilities: ClientCapabilities) { },
			getState(): FeatureState {
				return { kind: "static" };
			},
			initialize(serverCapabilities) {
				that.isSupported = !!serverCapabilities.experimental?.updateDiagnosticInformation;
			},
		};
	}

	private async updateDiagnosticInformationIfRelevantConfigChanged(e: ConfigurationChangeEvent) {
		if (!this.isSupported)
			return;

		let affected = false;

		for (const section of Object.keys(interestingSettings)) {
			affected ||= e.affectsConfiguration(section, { languageId: "dart" });
		}
		if (workspace.workspaceFolders) {
			for (let i = 0; i < (workspace.workspaceFolders?.length ?? 0); i++) {
				const folder = workspace.workspaceFolders[i];
				for (const section of Object.keys(interestingSettings)) {
					affected ||= e.affectsConfiguration(section, { uri: folder.uri, languageId: "dart" });
				}
			}
		}

		if (affected)
			await this.updateDiagnosticInformationIfSupported();
	}

	public async updateDiagnosticInformationIfSupported(): Promise<void> {
		if (!this.isSupported)
			return;

		try {
			const diagnosticInfo = {
				hostKind,
				settings: this.getInterestingSettings(),
			};
			return await this.client.sendRequest(UpdateDiagnosticInformationRequest.type, diagnosticInfo);
		} catch (error) {
			this.logger.warn(`Failed to update diagnostic information on the server: ${error}`);
		}
	}

	private getInterestingSettings() {
		const results: any = {};

		for (const section of Object.keys(interestingSettings)) {
			const c = workspace.getConfiguration(section, { languageId: "dart" });
			for (const setting of interestingSettings[section]) {
				const v = c.get(setting);
				if (v !== undefined) {
					results.global ??= {};
					results.global[`${section}.${setting}`] = v;
				}
			}
		}
		if (workspace.workspaceFolders) {
			for (let i = 0; i < (workspace.workspaceFolders?.length ?? 0); i++) {
				const folder = workspace.workspaceFolders[i];
				for (const section of Object.keys(interestingSettings)) {
					const c = workspace.getConfiguration(section, { uri: folder.uri, languageId: "dart" });
					for (const setting of interestingSettings[section]) {
						const vs = c.inspect(setting);
						const v = vs?.workspaceFolderLanguageValue ?? vs?.workspaceFolderValue;
						const thisValueJson = JSON.stringify(v);
						const globalValueJson = JSON.stringify(results.global[`${section}.${setting}`]);
						const isDifferentToGlobal = thisValueJson !== globalValueJson;
						if (v !== undefined && isDifferentToGlobal) {
							results[`folder_${i}`] ??= {};
							results[`folder_${i}`][`${section}.${setting}`] = v;
						}
					}
				}
			}
		}

		return results;
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

export class UpdateDiagnosticInformationRequest {
	public static type = new RequestType<object, void, void>("dart/updateDiagnosticInformation");
}
