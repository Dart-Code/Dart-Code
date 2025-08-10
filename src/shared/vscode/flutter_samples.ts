import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { FlutterCapabilities } from "../capabilities/flutter";
import { dartCodeExtensionIdentifier } from "../constants";
import { FlutterCreateTriggerData } from "../interfaces";
import { getRandomInt, mkDirRecursive } from "../utils/fs";
import { writeFlutterSdkSettingIntoProject, writeFlutterTriggerFile } from "../utils/projects";

export function createFlutterSampleInTempFolder(_flutterCapabilities: FlutterCapabilities, sampleID: string, flutterSdkOverride?: string): vs.Uri | undefined {
	// Create a temp folder for the sample.
	const tempSamplePath = path.join(os.tmpdir(), dartCodeExtensionIdentifier, "flutter", "sample", sampleID, getRandomInt(0x1000, 0x10000).toString(16));

	// Create the empty folder so we can open it.
	mkDirRecursive(tempSamplePath);

	const triggerData: FlutterCreateTriggerData = { sample: sampleID };
	writeFlutterTriggerFile(tempSamplePath, triggerData);

	// If we're using a custom SDK, we need to apply it to the new project too.
	if (flutterSdkOverride)
		writeFlutterSdkSettingIntoProject(flutterSdkOverride, tempSamplePath);

	const folderUri = vs.Uri.file(tempSamplePath);
	void vs.commands.executeCommand("vscode.openFolder", folderUri);

	return folderUri;
}
