"use strict";

import * as path from "path";
import * as fs from "fs";
import { window, commands, Uri, WorkspaceFolder } from "vscode";
import { ProjectType } from "../utils";

export function isPubGetProbablyRequired(ws: WorkspaceFolder): boolean {
	const folder = ws.uri.fsPath;
	const pubspecPath = path.join(folder, "pubspec.yaml");
	const packagesPath = path.join(folder, ".packages");
	if (!folder || !fs.existsSync(pubspecPath)) {
		console.log("no pubspec");
		return false;
	}

	// If we don't appear to have deps listed in pubspec, then no point prompting.
	const regex = new RegExp("dependencies\\s*:", "i");
	if (!regex.test(fs.readFileSync(pubspecPath).toString())) {
		console.log("no deps");
		return false;
	}

	// If we don't have .packages, we probably need running.
	if (!fs.existsSync(packagesPath)) {
		console.log("no packages");
		return true;
	}

	const pubspecModified = fs.statSync(pubspecPath).mtime;
	const packagesModified = fs.statSync(packagesPath).mtime;

	console.log(pubspecModified + " vs " + packagesModified);

	return pubspecModified > packagesModified;
}

export function promptToRunPubGet(folders: WorkspaceFolder[]) {
	const label = "Fetch packages";
	window.showInformationMessage("Some packages are missing or out of date, would you like to fetch them now?", label).then((clickedButton) => {
		if (clickedButton === label)
			fetchPackages(folders);
	});
}

function fetchPackages(folders: WorkspaceFolder[]) {
	let task = commands.executeCommand("dart.fetchPackages", folders[0].uri);
	for (let i = 1; i < folders.length; i++) {
		task = task.then((code) => {
			if (code === 0) // Continue with next one only if success
				return commands.executeCommand("dart.fetchPackages", folders[i].uri);
		});
	}
}
