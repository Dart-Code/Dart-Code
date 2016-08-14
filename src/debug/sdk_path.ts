"use strict"

// This file exists to write the SDK path from config in the extension and read it from the
// debug adapter. Everything imported here must be available in both places (eg. no vscode).
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

const sdkPathStoreName = "dart-code.sdk";
const sdkPathStore = path.join(os.tmpdir(), sdkPathStoreName);

export function readSdkPath(): string {
	// If this file doesn't exist, return null. We'll have to hope it's
	// in PATH.
	try {
		return fs.readFileSync(sdkPathStore, "utf8").trim();
	}
	catch (e) {
		return null;
	}
}

export function writeSdkPath(sdkPath: string) {
	try {
		fs.writeFileSync(sdkPathStore, sdkPath, "utf8");
	}
	catch (e) {
		console.warn(e);
	}
}
