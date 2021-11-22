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

const dependencyVariants: vs.QuickPickItem[] = [
	{
		label: "local",
	},
	{
		label: "git remote repository",
	},
	{
		label: "pub server",
	},
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
		this.disposables.push(vs.commands.registerCommand("_dart.removeDependency", this.removeDependency, this));

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
		if (!fs.existsSync(cacheFile))
			return;
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

		const selectedPackage = await this.promptForPackage();
		if (!selectedPackage)
			return;

		this.addDependency(uri, selectedPackage, isDevDependency);
	}

	private async addDependency(uri: string | vs.Uri, selectedPackage: string | LocalPubPackage | GitPubPackage, isDevDependency: boolean) {
		if (typeof uri === "string")
			uri = vs.Uri.file(uri);


		const args: string[] = ["add"];
		let pubPackage: string | undefined;
		if (typeof selectedPackage === "string") {
			pubPackage = selectedPackage;
			args.push(pubPackage);
		} else if ("url" in selectedPackage) {
			pubPackage = selectedPackage.packageName;
			args.push(pubPackage);
			args.push(`--git-url=${selectedPackage.url}`);
			if (selectedPackage.ref) {
				args.push(`--git-ref=${selectedPackage.ref}`);
			}
			if (selectedPackage.path) {
				args.push(`--git-path=${selectedPackage.path}`);
			}
		} else {
			pubPackage = selectedPackage.packageName;
			args.push(pubPackage);
			args.push(`--path=${selectedPackage.path}`);
		}

		if (isDevDependency)
			args.push("--dev");

		// Handle some known Flutter dependencies.
		const isFlutterSdkPackage = knownFlutterSdkPackages.includes(pubPackage ?? "");
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

	private async removeDependency(uri: string | vs.Uri, packageName: string) {
		if (typeof uri === "string")
			uri = vs.Uri.file(uri);

		const args = ["remove", packageName];

		if (this.sdks.flutter && util.isInsideFlutterProject(uri)) {
			return this.runFlutter(["pub", ...args], uri);
		} else {
			return this.runPub(args, uri);
		}
	}

	private async promptForPackage(): Promise<string | LocalPubPackage | GitPubPackage | undefined> {
		const quickPick = vs.window.createQuickPick<vs.QuickPickItem>();
		quickPick.placeholder = "Select dependency variant";
		quickPick.items = dependencyVariants;

		const selectedPackage = await new Promise<vs.QuickPickItem | undefined>((resolve) => {
			quickPick.onDidAccept(() => resolve(quickPick.selectedItems && quickPick.selectedItems[0]));
			quickPick.onDidHide(() => resolve(undefined));
			quickPick.show();
		});

		quickPick.dispose();
		switch (selectedPackage) {
			case dependencyVariants[0]:
				return await this.getLocalDependencies();
			case dependencyVariants[1]:
				return await this.getFromGitRepository();
			case dependencyVariants[2]:
				return await this.getPubDependencies();
		}
	}

	private async getLocalDependencies(): Promise<LocalPubPackage | undefined> {
		const packagePath = await vs.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: "Select Package",
		});

		let isValidPubPackage = false;
		let pubspecPackageName: string;
		const pubspecPackageNameRegex = /^name: (\w+)$/gm;
		if (packagePath) {
			fs.readdirSync(packagePath[0].path, { encoding: "utf-8" }).forEach((file) => {
				if (file === "pubspec.yaml") {
					isValidPubPackage = true;
					pubspecPackageName = fs.readFileSync(`${packagePath[0].path}/${file}`, { encoding: "ascii" });
					const regexpResult = pubspecPackageNameRegex.exec(pubspecPackageName);
					if (!regexpResult) {
						isValidPubPackage = false;
					} else {
						pubspecPackageName = regexpResult[1];
					}
					return;
				}
			});

			if (!isValidPubPackage) {
				vs.window.showErrorMessage(`"${packagePath[0].path.split(path.sep).slice(-1)}" is not a valid pub package`);
			}
		}
		return isValidPubPackage ? { path: packagePath![0].path, packageName: pubspecPackageName! } : undefined;
	}

	private async getFromGitRepository(): Promise<GitPubPackage | undefined> {
		const repoPackageName = await vs.window.showInputBox({
			placeHolder: "Enter package name",
		});
		if (!repoPackageName) {
			return;
		}

		const repoURL = await vs.window.showInputBox({
			placeHolder: "Enter git remote repository url",
		});
		if (!repoURL) {
			return;
		}

		const repoRef = await vs.window.showInputBox({
			placeHolder: "Which reference of the git repository?",
		});

		const repoPath = await vs.window.showInputBox({
			placeHolder: "Where is the package located in the repository?",
		});
		return {
			packageName: repoPackageName,
			path: repoPath,
			ref: repoRef,
			url: repoURL,
		};
	}

	private async getPubDependencies(): Promise<string | undefined> {
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
		let matches = new Set<string>();
		// This list can be quite large, so avoid using .filter() if we can bail out early.
		if (prefix) {
			for (let i = 0; i < packageNames.length && matches.size < max; i++) {
				const packageName = packageNames[i];
				if (packageName.startsWith(prefix))
					matches.add(packageName);
			}
			// Also add on any Flutter-SDK packages that match.
			for (const packageName of knownFlutterSdkPackages) {
				if (packageName.startsWith(prefix))
					matches.add(packageName);
			}
		} else {
			matches = new Set(packageNames.slice(0, Math.min(max, packageNames.length)));
		}

		return Array.from(matches).map((packageName) => ({
			label: packageName,
			packageName,
		} as PickablePackage));
	}
}

export type PickablePackage = vs.QuickPickItem & { packageName: string };

export interface GitPubPackage {
	url: string;
	packageName: string;
	ref?: string;
	path?: string;
}
export interface LocalPubPackage {
	path: string;
	packageName: string;
}
