import * as path from "path";
import { Uri, workspace } from "vscode";
import { escapeRegExp } from "../utils";
import { fsPath, isWithinPathOrEqual } from "../utils/fs";

const debugTypeTokenRegex = new RegExp(escapeRegExp("${debugType}"), "gi");

export function getTemplatedLaunchConfigs(documentUri: Uri, fileType: string, onlyGlobal = false) {
	const runConfigs: TemplatedLaunchConfig[] = workspace.getConfiguration("launch", documentUri).get<any[]>("configurations") || [];
	const wantedTemplateTypes = [`run-${fileType}`, `debug-${fileType}`];
	const filePath = fsPath(documentUri);
	const workspaceUri = workspace.getWorkspaceFolder(documentUri)?.uri;
	const workspacePath = workspaceUri ? fsPath(workspaceUri) : undefined;

	// Loop through each launch config and add the relevant templates. Configs may be
	// added multiple times if they have multiple template types.
	const runFileTemplates: Array<{ name: string, template: string }> = [];
	for (const templateType of wantedTemplateTypes) {
		const relevantLaunchConfigs = runConfigs
			.filter((c) => c.type === "dart" && isTemplateOfType(c, templateType))
			.filter((c) => {
				if (!c.codeLens?.path)
					// Always include things with no path.
					return true;
				else if (onlyGlobal)
					// Don't return anything that has a path if we only want global.
					return false;
				else
					// Otherwise, check the path.
					return workspacePath ? isWithinPathOrEqual(filePath, path.join(workspacePath, c.codeLens?.path)) : false;
			});
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
