import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { DartWorkspaceContext, Logger } from "../../shared/interfaces";
import { PubApi } from "../../shared/pub/api";
import { PackageCacheData } from "../../shared/pub/pub_add";
import { Context } from "../../shared/vscode/workspace";
import * as util from "../utils";
import { getFolderToRunCommandIn } from "../utils/vscode/projects";
import { BaseSdkCommands } from "./sdk";

const cacheFilename = "package_cache.json";
const knownFlutterSdkPackages = [
	"flutter",
	"flutter_test",
	"flutter_driver",
	"flutter_localizations",
	"integration_test",
];

export class AddDependencyCommand extends BaseSdkCommands {
	private readonly extensionStoragePath: string | undefined;
	private cache: PackageCacheData | undefined;
	private nextPackageNameFetchTimeout: NodeJS.Timeout | undefined;

	constructor(logger: Logger, context: Context, workspace: DartWorkspaceContext, dartCapabilities: DartCapabilities, private readonly pubApi: PubApi) {
		super(logger, context, workspace, dartCapabilities);

		this.disposables.push(vs.commands.registerCommand("dart.addDependency", (uri) => this.promptAndAddDependency(uri, false)));
		this.disposables.push(vs.commands.registerCommand("dart.addDevDependency", (uri) => this.promptAndAddDependency(uri, true)));
		this.disposables.push(vs.commands.registerCommand("_dart.addDependency", this.addDependency, this));

		this.extensionStoragePath = context.extensionStoragePath;
		// Kick off async work to fetch then queue a new check.
		this.loadAndFetch().catch((e) => this.logger.error(e));
	}

	private async loadAndFetch() {
		try {
			await this.loadPackageCache();
		} finally {
			this.queueNextPackageNameFetch(this.cache?.cacheTimeRemainingMs ?? 0);
		}
	}

	private async loadPackageCache(): Promise<void> {
		if (!this.extensionStoragePath)
			return;

		const cacheFile = path.join(this.extensionStoragePath, cacheFilename);
		try {
			const contents = await fs.promises.readFile(cacheFile);
			this.cache = PackageCacheData.fromJson(contents.toString());
		} catch (e) {
			this.logger.error(`Failed to read package cache file: ${e}`);
		}
	}

	private async savePackageCache(): Promise<void> {
		if (!this.extensionStoragePath)
			return;

		const cacheFile = path.join(this.extensionStoragePath, cacheFilename);
		try {
			const json = this.cache?.toJson();
			if (json)
				await fs.promises.writeFile(cacheFile, json);
		} catch (e) {
			this.logger.error(`Failed to read package cache file: ${e}`);
		}
	}

	private queueNextPackageNameFetch(ms: number) {
		if (this.nextPackageNameFetchTimeout)
			clearTimeout(this.nextPackageNameFetchTimeout);
		this.nextPackageNameFetchTimeout = setTimeout(() => this.fetchPackageNames(), ms);
	}

	private async fetchPackageNames(): Promise<void> {
		this.logger.info(`Caching Pub package names from pub.dev...`);
		try {
			const results = await this.pubApi.getPackageNames();
			this.cache = PackageCacheData.fromPackageNames(results.packages);
			await this.savePackageCache();
		} catch (e) {
			this.logger.error(`Failed to fetch package cache: $e`);
		}
		this.queueNextPackageNameFetch(PackageCacheData.maxCacheAgeMs);
	}

	private async promptAndAddDependency(uri: string | vs.Uri | undefined, isDevDependency: boolean) {
		if (!uri || !(uri instanceof vs.Uri)) {
			uri = await getFolderToRunCommandIn(this.logger, "Select which folder to add the dependency to");
			// If the user cancelled, bail out (otherwise we'll prompt them again below).
			if (!uri)
				return;
		}
		if (typeof uri === "string")
			uri = vs.Uri.file(uri);

		const selectedPackageName = await this.promptForPackage();
		if (!selectedPackageName)
			return;

		this.addDependency(uri, selectedPackageName, isDevDependency);
	}

	private async addDependency(uri: string | vs.Uri, packageName: string, isDevDependency: boolean) {
		if (typeof uri === "string")
			uri = vs.Uri.file(uri);

		const args = ["add", packageName];
		if (isDevDependency)
			args.push("--dev");

		// Handle some known Flutter dependencies.
		const isFlutterSdkPackage = knownFlutterSdkPackages.includes(packageName);
		if (isFlutterSdkPackage) {
			args.push("--sdk");
			args.push("flutter");
		}

		if (this.sdks.flutter && (isFlutterSdkPackage || util.isInsideFlutterProject(uri))) {
			return this.runFlutter(["pub", ...args], uri);
		} else {
			return this.runPub(args, uri);
		}
	}

	private async promptForPackage(): Promise<string | undefined> {
		const quickPick = vs.window.createQuickPick<PickablePackage>();
		quickPick.placeholder = "Enter a package name";
		quickPick.items = this.getMatchingPackages();
		quickPick.onDidChangeValue((prefix) => {
			quickPick.items = this.getMatchingPackages(prefix);
		});

		const selectedPackage = await new Promise<PickablePackage | undefined>((resolve) => {
			quickPick.onDidAccept(() => resolve(quickPick.selectedItems && quickPick.selectedItems[0]));
			quickPick.onDidHide(() => resolve(undefined));
			quickPick.show();
		});

		quickPick.dispose();

		return selectedPackage?.packageName;
	}

	private getMatchingPackages(prefix?: string): PickablePackage[] {
		const max = 50;
		const packageNames = this.cache?.packageNames ?? [];
		let matches = [];
		// This list can be quite large, so avoid using .filter() if we can bail out early.
		if (prefix) {
			for (let i = 0; i < packageNames.length && matches.length < max; i++) {
				const packageName = packageNames[i];
				if (packageName.startsWith(prefix))
					matches.push(packageName);
			}
		} else {
			matches = packageNames.slice(0, Math.min(max, packageNames.length));
		}

		return matches.map((packageName) => ({
			label: packageName,
			packageName,
		} as PickablePackage));
	}
}

export type PickablePackage = vs.QuickPickItem & { packageName: string };
