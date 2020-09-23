import * as path from "path";
import { TextDocument, workspace } from "vscode";
import { escapeRegExp } from "../utils";
import { fsPath, isWithinPath } from "../utils/fs";

const debugTypeTokenRegex = new RegExp(escapeRegExp("${debugType}"), "gi");

export function getTemplatedLaunchConfigs(document: TextDocument, fileType: string) {
	const runConfigs: TemplatedLaunchConfig[] = workspace.getConfiguration("launch", document.uri).get<any[]>("configurations") || [];
	const wantedTemplateTypes = [`run-${fileType}`, `debug-${fileType}`];
	const filePath = fsPath(document.uri);
	const workspaceUri = workspace.getWorkspaceFolder(document.uri)?.uri;
	const workspacePath = workspaceUri ? fsPath(workspaceUri) : undefined;

	// Loop through each launch config and add the relevant templates. Configs may be
	// added multiple times if they have multiple template types.
	const runFileTemplates: Array<{ name: string, template: string }> = [];
	for (const templateType of wantedTemplateTypes) {
		const relevantLaunchConfigs = runConfigs
			.filter((c) => c.type === "dart" && isTemplateOfType(c, templateType))
			.filter((c) => c.codeLens?.path && workspacePath ? isWithinPath(filePath, path.join(workspacePath, c.codeLens?.path)) : !c.codeLens?.path);
		for (const launchConfig of relevantLaunchConfigs) {
			runFileTemplates.push({
				...launchConfig,
				name: (launchConfig.codeLens?.title || launchConfig.name || "${debugType}").replace(debugTypeTokenRegex, templateType.startsWith("run-") ? "Run" : "Debug"),
				template: templateType,
			});
		}
	}

	return runFileTemplates;
}

export function isTemplateOfType(config: TemplatedLaunchConfig, templateType: string): boolean {
	const template = config.codeLens?.for || config.template;
	return !!template && (
		(typeof template === "string" && template === templateType)
		|| (Array.isArray(template) && template.indexOf(templateType) !== -1)
	);
}

export interface TemplatedLaunchConfig {
	name?: string;
	type?: string;
	template: string;
	codeLens?: {
		for: string | string[];
		path?: string;
		title?: string;
	};
}
