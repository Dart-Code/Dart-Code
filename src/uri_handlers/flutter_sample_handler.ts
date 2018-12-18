import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { dartCodeExtensionIdentifier } from "../debug/utils";
import { FlutterCapabilities } from "../flutter/capabilities";
import * as util from "../utils";

export class FlutterSampleUriHandler {
	constructor(private flutterCapabilities: FlutterCapabilities) { }

	public async handle(sampleID: string): Promise<void> {
		if (!this.isValidSampleName(sampleID)) {
			vs.window.showErrorMessage(`${sampleID} is not a valid Flutter sample identifier`);
			return;
		}

		// Ensure we're on at least Flutter v1 so we know creating samples works.
		if (!this.flutterCapabilities.supportsCreatingSamples) {
			vs.window.showErrorMessage("Opening sample projects requires Flutter v1.0 or later");
			return;
		}

		// Create a temp folder for the sample.
		const tempSamplePath = path.join(os.tmpdir(), dartCodeExtensionIdentifier, "flutter", "sample", sampleID, util.getRandomInt(0x1000, 0x10000).toString(16));

		// Create the empty folder so we can open it.
		util.mkDirRecursive(tempSamplePath);
		// Create a temp dart file to force extension to load when we open this folder.
		fs.writeFileSync(path.join(tempSamplePath, util.FLUTTER_CREATE_PROJECT_TRIGGER_FILE), sampleID);

		const hasFoldersOpen = !!(vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length);
		const openInNewWindow = hasFoldersOpen;
		vs.commands.executeCommand("vscode.openFolder", vs.Uri.file(tempSamplePath), openInNewWindow);
	}

	private readonly validSampleIdentifierPattern = new RegExp("^[\\w\\.]+$");
	private isValidSampleName(name: string): boolean {
		return this.validSampleIdentifierPattern.test(name);
	}
}
