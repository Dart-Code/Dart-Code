import * as path from "path";
import { Uri, workspace } from "vscode";
import { escapeRegExp } from "../utils";
import { fsPath, isWithinPathOrEqual } from "../utils/fs";

const debugTypeTokenRegex = new RegExp(escapeRegExp("${debugType}"), "gi");

/// Allows overriding the launch config used by Code Lens "Run"/"Debug" and runs through test runner.
export function getLaunchConfigDefaultTemplate(documentUri: Uri): TemplatedLaunchConfig | undefined {
	const runConfigs: TemplatedLaunchConfig[] = workspace.getConfiguration("launch", documentUri).get<any[]>("configurations") || [];
	const filePath = fsPath(documentUri);
	const workspaceUri = workspace.getWorkspaceFolder(documentUri)?.uri;
	const workspacePath = workspaceUri ? fsPath(workspaceUri) : undefined;

	return runConfigs.find((c) => c.type === "dart"
		&& c.templateFor !== undefined && c.templateFor !== null
		&& workspacePath ? isWithinPathOrEqual(filePath, path.join(workspacePath, c.templateFor)) : false
	);
}

export function getTemplatedLaunchConfigs(documentUri: Uri, fileType: string): TemplatedLaunchConfig[] {
	const runConfigs: TemplatedLaunchConfig[] = workspace.getConfiguration("launch", documentUri).get<any[]>("configurations") || [];
	const wantedTemplateTypes = [`run-${fileType}`, `debug-${fileType}`];
	const filePath = fsPath(documentUri);
	const workspaceUri = workspace.getWorkspaceFolder(documentUri)?.uri;
	const workspacePath = workspaceUri ? fsPath(workspaceUri) : undefined;

	// Loop through each launch config and add the relevant templates. Configs may be
	// added multiple times if they have multiple template types.
	const runFileTemplates: TemplatedLaunchConfig[] = [];
	for (const templateType of wantedTemplateTypes) {
		const relevantLaunchConfigs = runConfigs
			.filter((c) => c.type === "dart" && isTemplateOfType(c, templateType))
			.filter((c) => c.codeLens?.path && workspacePath ? isWithinPathOrEqual(filePath, path.join(workspacePath, c.codeLens?.path)) : !c.codeLens?.path);
		for (const launchConfig of relevantLaunchConfigs) {
			runFileTemplates.push({
				...launchConfig,
				name: (launchConfig.codeLens?.title || launchConfig.name || "${debugType}").replace(debugTypeTokenRegex, templateType.startsWith("run-") ? "Run" : "Debug"),
				noDebug: templateType.startsWith("run-"),
			});
		}
	}

	// If we didn't find any, try the defaults.
	if (!runFileTemplates.length) {
		const defaultTemplate = getLaunchConfigDefaultTemplate(documentUri);
		if (defaultTemplate) {
			runFileTemplates.push({ ...defaultTemplate, name: "Run", noDebug: true });
			runFileTemplates.push({ ...defaultTemplate, name: "Debug" });
		}
	}

	return runFileTemplates;
}

export function isTemplateOfType(config: TemplatedLaunchConfig, templateType: string): boolean {
	const template = config.codeLens?.for;
	return !!template && (
		(typeof template === "string" && template === templateType)
		|| (Array.isArray(template) && template.indexOf(templateType) !== -1)
	);
}

export interface TemplatedLaunchConfig {
	name: string;
	type?: string;
	noDebug?: boolean;
	templateFor?: string; // path to apply to
	codeLens?: {
		for: string | string[];
		path?: string;
		title?: string;
	};
	[key: string]: any;
}
