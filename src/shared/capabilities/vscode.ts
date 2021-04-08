import { version as codeVersion } from "vscode";
import { versionIsAtLeast } from "../utils";
import { isTheia } from "../vscode/utils_cloud";

export class CodeCapabilities {
	public version: string;

	constructor(version: string) {
		this.version = version;
	}

	// This version should match the minimum the LSP client we're using supports.
	// https://github.com/microsoft/vscode-languageserver-node/blob/main/client/src/node/main.ts#L25
	get supportsLatestLspClient() { return versionIsAtLeast(this.version, "1.52.0"); }
	// Theia doesn't currently support launching without a launch.json. This may need updating to also
	// check the version in future.
	get supportsDebugWithoutLaunchJson() { return !isTheia; }
	get editorConfigFolder() { return isTheia ? ".theia" : ".vscode"; }
}

export const vsCodeVersion = new CodeCapabilities(codeVersion);
