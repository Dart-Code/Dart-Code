import { version as codeVersion } from "vscode";
import { versionIsAtLeast } from "../utils";

export class CodeCapabilities {
	public version: string;

	constructor(version: string) {
		this.version = version;
	}

	// This version should match the minimum the LSP client we're using supports.
	// https://github.com/microsoft/vscode-languageserver-node/blob/main/client/src/node/main.ts#L25
	get supportsLatestLspClient() { return versionIsAtLeast(this.version, "1.52.0"); }
}

export const vsCodeVersion = new CodeCapabilities(codeVersion);
