// eslint-disable-next-line no-restricted-imports
import { version as codeVersion, env } from "vscode";
import { isCloudShell, isKnownCloudIde, isTheia } from "../vscode/utils_cloud";

export class CodeCapabilities {
	public version: string;

	constructor(version: string) {
		this.version = version;
	}

	// Theia doesn't currently support launching without a launch.json. This may need updating to also
	// check the version in future.
	get supportsDebugWithoutLaunchJson() { return !isTheia(env.appName); }
	// Cloud IDEs may have authentication issues trying to use embedded DevTools so just disable it.
	get supportsEmbeddedDevTools() { return !isKnownCloudIde(env.appName); }
	get supportsDevTools() { return !isCloudShell(env.appName); } // Until DevTools can work without SSE, it will not work on Cloud Shell.
	get editorConfigFolder() { return isTheia(env.appName) ? ".theia" : ".vscode"; }
}

export const vsCodeVersion = new CodeCapabilities(codeVersion);
