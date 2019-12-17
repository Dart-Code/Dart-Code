import * as fs from "fs";
import * as path from "path";
import { commands, Uri, window } from "vscode";
import { Logger } from "../../shared/interfaces";
import { fsPath } from "../../shared/vscode/utils";

export function isPubGetProbablyRequired(logger: Logger, folderUri: Uri): boolean {
	const folder = fsPath(folderUri);
	logger.warn(`Checking if pub get required for ${folder}`);
	const pubspecPath = path.join(folder, "pubspec.yaml");
	const packagesPath = path.join(folder, ".packages");
	if (!folder || !fs.existsSync(pubspecPath)) {
		logger.warn(`No need because folder or pubspec do not exist`);
		return false;
	}

	// If we don't appear to have deps listed in pubspec, then no point prompting.
	const regex = new RegExp("dependencies\\s*:", "i");
	if (!regex.test(fs.readFileSync(pubspecPath).toString())) {
		logger.warn(`No need because pubspec has no dependencies`);
		return false;
	}

	// If we don't have .packages, we probably need running.
	if (!fs.existsSync(packagesPath)) {
		logger.warn(`Required because there's no .packages file at ${packagesPath}`);
		return true;
	}

	const pubspecModified = fs.statSync(pubspecPath).mtime;
	const packagesModified = fs.statSync(packagesPath).mtime;

	if (pubspecModified > packagesModified) {
		logger.warn(`Required because pubspec mtime (${pubspecModified}) is after .packages mtime (${packagesModified})`);
		return true;
	}
	return false;
}

export function promptToRunPubGet(folders: Uri[]) {
	const label = "Get packages";
	window.showInformationMessage("Some packages are missing or out of date, would you like to get them now?", label).then((clickedButton) => {
		if (clickedButton === label)
			getPackages(folders);
	});
}

function getPackages(folders: Uri[]) {
	let task = commands.executeCommand("dart.getPackages", folders[0]);
	for (let i = 1; i < folders.length; i++) {
		task = task.then((code) => {
			if (code === 0) // Continue with next one only if success
				return commands.executeCommand("dart.getPackages", folders[i]);
		});
	}
}
