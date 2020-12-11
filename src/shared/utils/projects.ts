import * as fs from "fs";
import * as path from "path";
import { FLUTTER_CREATE_PROJECT_TRIGGER_FILE } from "../constants";
import { FlutterCreateTriggerData } from "../interfaces";

export function writeDartSdkSettingIntoProject(dartSdkPath: string, projectFolder: string): void {
	writeSettingIntoProject(projectFolder, { "dart.sdkPath": dartSdkPath });
}

export function writeFlutterTriggerFile(folderPath: string, triggerData: FlutterCreateTriggerData | undefined) {
	const jsonString = triggerData ? JSON.stringify(triggerData) : "";

	fs.writeFileSync(path.join(folderPath, FLUTTER_CREATE_PROJECT_TRIGGER_FILE), jsonString);
}

export function writeFlutterSdkSettingIntoProject(flutterSdkPath: string, projectFolder: string): void {
	writeSettingIntoProject(projectFolder, { "dart.flutterSdkPath": flutterSdkPath });
}

export function writeSettingIntoProject(projectFolder: string, settings: any): void {
	const vsCodeFolder = path.join(projectFolder, ".vscode");
	const settingsFile = path.join(vsCodeFolder, "settings.json");

	if (!fs.existsSync(vsCodeFolder))
		fs.mkdirSync(vsCodeFolder);

	// The file should never exist, because the user has to select a new folder
	// to create projects. If it exists, something is wrong. We can't just load
	// the file, because VS Code settings file are not standard JSON (they can
	// have comments) so we don't want to try and deal with parsing them.
	if (fs.existsSync(settingsFile))
		return;

	fs.writeFileSync(settingsFile, JSON.stringify(settings, undefined, 4));

}
