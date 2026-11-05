import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { dartVMPath, flutterPath } from "../constants";
import { Logger, Sdks } from "../interfaces";
import { versionIsAtLeast } from "../utils";
import { existsAndIsFileSync, getChildFolders, getSdkVersion, homeRelativePath, safeRealpathSync } from "../utils/fs";

export interface DartSdkManagerConfig {
	readonly sdkPath: string | undefined;
	readonly sdkPaths: string[];
	readonly sdkSwitchingTarget: "workspace" | "global";
	readonly workspaceSdkPath: string | undefined;
	setSdkPath(folder: string | undefined, target: vs.ConfigurationTarget): Promise<void>;
}

export interface FlutterSdkManagerConfig {
	readonly flutterSdkPath: string | undefined;
	readonly flutterSdkPaths: string[];
	readonly sdkSwitchingTarget: "workspace" | "global";
	readonly workspaceFlutterSdkPath: string | undefined;
	setFlutterSdkPath(folder: string | undefined, target: vs.ConfigurationTarget): Promise<void>;
}

abstract class SdkManager {
	constructor(private readonly logger: Logger, protected readonly sdks: Sdks) { }

	protected abstract get sdkPaths(): string[];
	protected abstract get currentSdk(): string | undefined;
	protected abstract get configuredSdk(): string | undefined;
	protected abstract get configName(): string;
	protected abstract get executablePath(): string;
	protected abstract get sdkSwitchingTarget(): "workspace" | "global";
	protected abstract getLabel(version: string): string;
	protected abstract clearWorkspaceSdk(): void;
	protected abstract setSdk(folder: string | undefined, target: vs.ConfigurationTarget): void;

	public changeSdk() {
		if (this.sdkPaths?.length)
			void this.promptForSdk(this.sdkPaths).catch((e) => this.logger.error(e));
		else
			void vs.window.showWarningMessage(`Set the "${this.configName}" setting to enable fast SDK switching.`);
	}

	public async promptForSdk(sdkPaths: string[]): Promise<void> {
		let allPaths: string[] = [];
		for (const sdkPath of sdkPaths.filter(fs.existsSync)) {
			allPaths.push(sdkPath);
			// Add immediate children to support folders-of-SDKs.
			allPaths = allPaths.concat(await getChildFolders(this.logger, sdkPath));
		}

		// Add in the current path if it's not there.
		if (this.currentSdk && !allPaths.includes(this.currentSdk))
			allPaths.push(this.currentSdk);

		const sdkFolders = allPaths
			.filter((f) => existsAndIsFileSync(path.join(f, this.executablePath))); // Only those that look like SDKs.

		const sdkItems: SdkPickItem[] = sdkFolders.map((f) => {
			// Resolve symlinks so we look in correct folder for version file.
			const actualBinary = safeRealpathSync(path.join(f, this.executablePath));
			// Then we need to take the executable name and /bin back off
			const actualFolder = path.dirname(path.dirname(actualBinary));

			const version = getSdkVersion(this.logger, { sdkRoot: actualFolder });
			return {
				description: f === this.currentSdk && this.configuredSdk ? "Current setting" : "",
				detail: homeRelativePath(f),
				folder: f,
				label: version ? this.getLabel(version) : "Unknown version",
				version,
			};
		})
			.sort((a, b) => versionIsAtLeast(a.version ?? "0.0.0", b.version ?? "0.0.0") ? 1 : -1);

		if (sdkItems.length === 0)
			return;

		const items = [{
			description: !this.configuredSdk ? "Current setting" : "",
			detail: !this.configuredSdk ? `Found at ${this.currentSdk}` : undefined,
			folder: undefined,
			label: "Auto-detect SDK location",
			version: undefined,
		} as SdkPickItem].concat(sdkItems);

		await vs.window.showQuickPick(items, { placeHolder: "Select an SDK to use" })
			.then((sdk) => {
				if (!sdk)
					return;

				const folder = homeRelativePath(sdk.folder);
				if (this.sdkSwitchingTarget === "global") {
					// Clear any existing workspace setting first.
					this.clearWorkspaceSdk();
					this.setSdk(folder, vs.ConfigurationTarget.Global);
				} else {
					this.setSdk(folder, vs.ConfigurationTarget.Workspace);
				}
			});
	}
}

export class DartSdkManager extends SdkManager {
	constructor(logger: Logger, private readonly config: DartSdkManagerConfig, sdks: Sdks) {
		super(logger, sdks);
	}

	protected get sdkPaths(): string[] { return this.config.sdkPaths; }
	protected get currentSdk(): string | undefined { return this.sdks.dart; }
	protected get configuredSdk(): string | undefined { return this.config.sdkPath; }
	protected get configName(): string { return "dart.sdkPaths"; }
	protected get executablePath() { return dartVMPath; }
	protected get sdkSwitchingTarget() { return this.config.sdkSwitchingTarget; }
	protected getLabel(version: string) {
		return `Dart SDK ${version}`;
	}
	protected clearWorkspaceSdk() {
		if (this.config.workspaceSdkPath)
			void this.config.setSdkPath(undefined, vs.ConfigurationTarget.Workspace);
	}
	protected setSdk(folder: string | undefined, target: vs.ConfigurationTarget) {
		void this.config.setSdkPath(folder, target);
	}
}

export class FlutterSdkManager extends SdkManager {
	constructor(logger: Logger, private readonly config: FlutterSdkManagerConfig, sdks: Sdks) {
		super(logger, sdks);
	}

	protected get sdkPaths(): string[] { return this.config.flutterSdkPaths; }
	protected get currentSdk(): string | undefined { return this.sdks.flutter; }
	protected get configuredSdk(): string | undefined { return this.config.flutterSdkPath; }
	protected get configName(): string { return "dart.flutterSdkPaths"; }
	protected get executablePath() { return flutterPath; }
	protected get sdkSwitchingTarget() { return this.config.sdkSwitchingTarget; }
	protected getLabel(version: string) {
		return `Flutter SDK ${version}`;
	}
	protected clearWorkspaceSdk() {
		if (this.config.workspaceFlutterSdkPath)
			void this.config.setFlutterSdkPath(undefined, vs.ConfigurationTarget.Workspace);
	}
	protected setSdk(folder: string | undefined, target: vs.ConfigurationTarget) {
		void this.config.setFlutterSdkPath(folder, target);
	}
}

interface SdkPickItem {
	description: string;
	detail: string | undefined;
	folder: string | undefined;
	label: string;
	version: string | undefined;
}
