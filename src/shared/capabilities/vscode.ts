import { version as codeVersion } from "vscode";
import { isTheia } from "../vscode/utils_cloud";

export class CodeCapabilities {
	public version: string;
	constructor(version: string) {
		this.version = version;
	}
	get supportsResolveDebugConfigurationWithSubstitutedVariables() { return !isTheia; }
	get requiresDwdsAuthenticationRedirect() { return isTheia; }
}

export const vsCodeVersion = new CodeCapabilities(codeVersion);
