import * as vs from "vscode";
import * as fs from "fs";
import * as path from "path";
import { hasDartExecutable, getSdkVersion, Sdks, versionIsAtLeast, hasFlutterExecutable } from "../utils";
import { config } from "../config";

abstract class SdkManager {
	protected sdks: Sdks;

	constructor(sdks: Sdks) {
		this.sdks = sdks;
	}

	protected abstract get sdkPaths(): string[];
	protected abstract get currentSdk(): string;
	protected abstract get configuredSdk(): string;
	protected abstract get configName(): string;
	protected abstract hasExecutable(path: string): boolean;
	protected abstract getLabel(path: string): string;
	protected abstract setSdk(folder: string): void;

	public changeSdk() {
		if (this.sdkPaths)
			this.searchForSdks(this.sdkPaths);
		else
			vs.window.showWarningMessage("Set `${configName}` to enable fast SDK switching.");
	}

	public searchForSdks(sdkPaths: string[]) {
		let allPaths: string[] = [];
		sdkPaths.filter(fs.existsSync).forEach((sdkPath) => {
			allPaths.push(sdkPath);
			allPaths = allPaths.concat(fs.readdirSync(sdkPath).map((p) => path.join(sdkPath, p)));
		});

		// Add in the current path if it's not there.
		if (allPaths.indexOf(this.currentSdk) === -1)
			allPaths.push(this.currentSdk);

		const sdkFolders = allPaths
			.filter((f) => fs.statSync(f).isDirectory()) // Only directories.
			.filter((f) => this.hasExecutable(path.join(f, "bin"))); // Only those that look like SDKs.

		const sdkItems = sdkFolders.map((f) => {
			const version = getSdkVersion(f);
			return {
				description: f,
				detail: fs.realpathSync(f) === this.currentSdk && this.configuredSdk ? "Current setting" : "",
				folder: f,
				label: this.getLabel(version),
				version,
			};
		})
			.sort((a, b) => versionIsAtLeast(a.version, b.version) ? 1 : -1);

		if (sdkItems.length === 0)
			return;

		const items = [{
			description: !this.configuredSdk ? `Found at ${this.currentSdk}` : undefined,
			detail: !this.configuredSdk ? "Current setting" : "",
			folder: undefined,
			label: "Auto-detect SDK location",
		}].concat(sdkItems);

		vs.window.showQuickPick(items, { placeHolder: "Select an SDK to use" })
			.then((sdk) => { if (sdk) this.setSdk(sdk.folder); });
	}
}

export class DartSdkManager extends SdkManager {
	protected get sdkPaths(): string[] { return config.sdkPaths; }
	protected get currentSdk(): string { return this.sdks.dart; }
	protected get configuredSdk(): string { return config.sdkPath; }
	protected get configName(): string { return "dart.sdkPaths"; }
	protected hasExecutable(path: string) { return hasDartExecutable(path); }
	protected getLabel(version: string) {
		return `Dart SDK ${version}`;
	}
	protected setSdk(folder: string) { config.setSdkPath(folder); }
}

export class FlutterSdkManager extends SdkManager {
	protected get sdkPaths(): string[] { return config.flutterSdkPaths; }
	protected get currentSdk(): string { return this.sdks.flutter; }
	protected get configuredSdk(): string { return config.flutterSdkPath; }
	protected get configName(): string { return "dart.flutterSdkPaths"; }
	protected hasExecutable(path: string) { return hasFlutterExecutable(path); }
	protected getLabel(version: string) {
		return `Flutter SDK ${version}`;
	}
	protected setSdk(folder: string) { config.setFlutterSdkPath(folder); }
}
