import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { dartVMPath, flutterPath } from "../../shared/constants";
import { Logger, Sdks } from "../../shared/interfaces";
import { versionIsAtLeast } from "../../shared/utils";
import { getChildFolders } from "../../shared/utils/fs";
import { config } from "../config";
import { getSdkVersion } from "../utils";

abstract class SdkManager {
	constructor(private readonly logger: Logger, protected readonly sdks: Sdks) { }

	protected abstract get sdkPaths(): string[];
	protected abstract get currentSdk(): string | undefined;
	protected abstract get configuredSdk(): string | undefined;
	protected abstract get configName(): string;
	protected abstract get executablePath(): string;
	protected abstract getLabel(version: string): string;
	protected abstract setSdk(folder: string | undefined): void;

	public changeSdk() {
		if (this.sdkPaths)
			this.searchForSdks(this.sdkPaths);
		else
			vs.window.showWarningMessage("Set `${configName}` to enable fast SDK switching.");
	}

	public async searchForSdks(sdkPaths: string[]) {
		let allPaths: string[] = [];
		for (const sdkPath of sdkPaths.filter(fs.existsSync)) {
			allPaths.push(sdkPath);
			// Add immediate children to support folders-of-SDKs.
			allPaths = allPaths.concat(await getChildFolders(sdkPath));
		}

		// Add in the current path if it's not there.
		if (this.currentSdk && allPaths.indexOf(this.currentSdk) === -1)
			allPaths.push(this.currentSdk);

		const sdkFolders = allPaths
			// We don't need to check isDirectory, since existsSync() will just return false
			// if we join a filename on the end of another.
			// .filter((f) => fs.statSync(f).isDirectory()) // Only directories.
			.filter((f) => fs.existsSync(path.join(f, this.executablePath))); // Only those that look like SDKs.

		const sdkItems: SdkPickItem[] = sdkFolders.map((f) => {
			// Resolve synlinks so we look in correct folder for version file.
			const actualBinary = fs.realpathSync(path.join(f, this.executablePath));
			// Then we need to take the executable name and /bin back off
			const actualFolder = path.dirname(path.dirname(actualBinary));

			const version = getSdkVersion(this.logger, { sdkRoot: actualFolder });
			return {
				description: f === this.currentSdk && this.configuredSdk ? "Current setting" : "",
				detail: f,
				folder: f,
				label: version ? this.getLabel(version) : "Unknown version",
				version,
			};
		})
			.sort((a, b) => versionIsAtLeast(a.version || "0.0.0", b.version || "0.0.0") ? 1 : -1);

		if (sdkItems.length === 0)
			return;

		const items = [{
			description: !this.configuredSdk ? "Current setting" : "",
			detail: !this.configuredSdk ? `Found at ${this.currentSdk}` : undefined,
			folder: undefined,
			label: "Auto-detect SDK location",
			version: undefined,
		} as SdkPickItem].concat(sdkItems);

		vs.window.showQuickPick(items, { placeHolder: "Select an SDK to use" })
			.then((sdk) => { if (sdk) this.setSdk(sdk.folder); });
	}
}

export class DartSdkManager extends SdkManager {
	protected get sdkPaths(): string[] { return config.sdkPaths; }
	protected get currentSdk(): string | undefined { return this.sdks.dart; }
	protected get configuredSdk(): string | undefined { return config.sdkPath; }
	protected get configName(): string { return "dart.sdkPaths"; }
	protected get executablePath() { return dartVMPath; }
	protected getLabel(version: string) {
		return `Dart SDK ${version}`;
	}
	protected setSdk(folder: string | undefined) { config.setSdkPath(folder); }
}

export class FlutterSdkManager extends SdkManager {
	protected get sdkPaths(): string[] { return config.flutterSdkPaths; }
	protected get currentSdk(): string | undefined { return this.sdks.flutter; }
	protected get configuredSdk(): string | undefined { return config.flutterSdkPath; }
	protected get configName(): string { return "dart.flutterSdkPaths"; }
	protected get executablePath() { return flutterPath; }
	protected getLabel(version: string) {
		return `Flutter SDK ${version}`;
	}
	protected setSdk(folder: string | undefined) { config.setFlutterSdkPath(folder); }
}

interface SdkPickItem {
	description: string;
	detail: string | undefined;
	folder: string | undefined;
	label: string;
	version: string | undefined;
}
