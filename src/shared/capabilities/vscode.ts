import { version as codeVersion } from "vscode";
import { versionIsAtLeast } from "../utils";

export class CodeCapabilities {
	public version: string;
	constructor(version: string) {
		this.version = version;
	}
	get hasWindowSnippetFix() { return !versionIsAtLeast(this.version, "1.42.0"); }
}

export const vsCodeVersion = new CodeCapabilities(codeVersion);
