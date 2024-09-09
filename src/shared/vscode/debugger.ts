import { minimatch } from "minimatch";
import * as path from "path";
import { Uri, workspace } from "vscode";
import { escapeRegExp } from "../utils";
import { fsPath, isWithinPathOrEqual } from "../utils/fs";

const debugTypeTokenRegex = new RegExp(escapeRegExp("${debugType}"), "gi");

/// Allows overriding the launch config used by Code Lens "Run"/"Debug", test runner, editor launch buttons, explorer context menu.
///
/// Tries to get the most specific config first (eg. using an explicit `noDebug` flag) and otherwise falls back to
/// a generic (no `noDebug` specified) one, injecting the value of `debug` inverted as `noDebug`.
export function getLaunchConfigDefaultTemplate(documentUri: Uri, debug: boolean): TemplatedLaunchConfig | undefined {
	const runConfigs: TemplatedLaunchConfig[] = workspace.getConfiguration("launch", documentUri).get<any[]>("configurations") || [];
	const filePath = fsPath(documentUri);
	const workspaceUri = workspace.getWorkspaceFolder(documentUri)?.uri;
	const workspacePath = workspaceUri ? fsPath(workspaceUri) : undefined;

	const validConfigs = runConfigs.filter((c) => c.type === "dart"
		&& c.templateFor !== undefined && c.templateFor !== null
		&& workspacePath ? isWithinPathOrEqual(filePath, path.join(workspacePath, c.templateFor)) : false
	);

	const requiredNoDebugValue = !debug;
	const bestConfig =
		// Try specific config first.
		validConfigs.find((c) => c.noDebug === requiredNoDebugValue)
		// Otherwise, look for one that doesn't specify noDebug.
		?? validConfigs.find((c) => c.noDebug === undefined);

	return bestConfig ? { ...bestConfig, noDebug: requiredNoDebugValue } : undefined;
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
			.filter((c) => codeLensIsValidForFile(c.codeLens, workspacePath, filePath));
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
		const defaultRunTemplate = getLaunchConfigDefaultTemplate(documentUri, false);
		const defaultDebugTemplate = getLaunchConfigDefaultTemplate(documentUri, true);
		if (defaultRunTemplate)
			runFileTemplates.push({ ...defaultRunTemplate, name: "Run" });
		if (defaultDebugTemplate)
			runFileTemplates.push({ ...defaultDebugTemplate, name: "Debug" });
	}

	return runFileTemplates;
}

function codeLensIsValidForFile(codeLens: TemplatedLaunchConfig["codeLens"], workspacePath: string | undefined, filePath: string) {
	if (!codeLens?.path)
		return true;

	// Handle globs.
	if (codeLens.path.startsWith("**/"))
		return minimatch(filePath, codeLens.path, { dot: true });

	// Otherwise, withinPathOrEqual, which requires a workspacePath.
	return workspacePath ? isWithinPathOrEqual(filePath, path.join(workspacePath, codeLens?.path)) : false;
}

export function isTemplateOfType(config: TemplatedLaunchConfig, templateType: string): boolean {
	const template = config.codeLens?.for;
	return !!template && (
		(typeof template === "string" && template === templateType)
		|| (Array.isArray(template) && template.includes(templateType))
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
