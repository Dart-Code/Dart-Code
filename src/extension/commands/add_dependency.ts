import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { DartWorkspaceContext, Logger } from "../../shared/interfaces";
import { PubApi } from "../../shared/pub/api";
import { PackageCacheData } from "../../shared/pub/pub_add";
import { fsPath } from "../../shared/utils/fs";
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

		const selectedPackage = await this.promptForPackageInfo();
		if (!selectedPackage)
			return;

		this.addDependency(uri, selectedPackage, isDevDependency);
	}

	private async addDependency(uri: string | vs.Uri, selectedPackage: PackageInfo, isDevDependency: boolean) {
		if (typeof uri === "string")
			uri = vs.Uri.file(uri);

		const args = ["add"];
		let packageName: string;
		if (selectedPackage.marker === "GIT") {
			packageName = selectedPackage.packageName;
			args.push(packageName);
			args.push(`--git-url=${selectedPackage.url}`);
			if (selectedPackage.ref) {
				args.push(`--git-ref=${selectedPackage.ref}`);
			}
			if (selectedPackage.path) {
				args.push(`--git-path=${selectedPackage.path}`);
			}
		} else if (selectedPackage.marker === "PATH") {
			packageName = selectedPackage.packageName;
			args.push(packageName);
			args.push(`--path=${selectedPackage.path}`);
		} else {
			packageName = selectedPackage.packageName;
			args.push(packageName);
		}

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

	/// Prompts the user to select a package name, or the option to select a path or Git package (in
	/// which case they must also provide package name etc).
	private async promptForPackageInfo(): Promise<PackageInfo | undefined> {
		const quickPick = vs.window.createQuickPick<PickablePackage>();
		quickPick.placeholder = "package name, URL or path";
		quickPick.title = "Enter a package name, URL or local path";
		quickPick.items = this.getPackageEntries();
		quickPick.onDidChangeValue((prefix) => {
			quickPick.items = this.getPackageEntries(prefix);
		});

		const selectedOption = await new Promise<string | PickablePackage | undefined>((resolve) => {
			quickPick.onDidAccept(() => resolve(quickPick.selectedItems && quickPick.selectedItems[0] ? quickPick.selectedItems[0] : quickPick.value));
			quickPick.onDidHide(() => resolve(undefined));
			quickPick.show();
		});

		quickPick.dispose();

		if (!selectedOption)
			return;

		let packageInfo: PackageInfo | undefined;
		if (typeof selectedOption === "string") {
			// For convenience, we handle string URLs/paths too.
			if (selectedOption.startsWith("http://") || selectedOption.startsWith("https://"))
				packageInfo = await this.promptForGitPackageInfo(selectedOption);
			else if (selectedOption.includes("/") || selectedOption.includes("\\"))
				packageInfo = await this.promptForPathPackageInfo(selectedOption);
			else
				packageInfo = { packageName: selectedOption, marker: undefined };
		} else {
			switch (selectedOption.marker) {
				case "PATH":
					packageInfo = await this.promptForPathPackageInfo();
					break;
				case "GIT":
					packageInfo = await this.promptForGitPackageInfo();
					break;
				default:
					packageInfo = selectedOption as PubPackage;
					break;
			}
		}

		return packageInfo;
	}

	private async promptForPathPackageInfo(packagePath?: string): Promise<PathPubPackage | undefined> {
		if (!packagePath) {
			const packagePaths = await vs.window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: "Select package folder",
			});

			if (!packagePaths || packagePaths.length !== 1)
				return;

			packagePath = fsPath(packagePaths[0]);
		}
		if (!packagePath)
			return;

		try {
			const pubspecPackageNameRegex = /^name: (\w+)$/gm;
			const pubspecContent = fs.readFileSync(path.join(packagePath, "pubspec.yaml"), "utf8");
			const packageNameResult = pubspecPackageNameRegex.exec(pubspecContent);
			if (packageNameResult)
				return { path: packagePath, packageName: packageNameResult[1], marker: "PATH" };
		} catch (e) {
			this.logger.error(e);
			vs.window.showErrorMessage("The selected folder does not appear to be a valid Pub package");
			return;
		}
	}

	private async promptForGitPackageInfo(repoUrl?: string): Promise<GitPubPackage | undefined> {
		if (!repoUrl) {
			repoUrl = await vs.window.showInputBox({
				ignoreFocusOut: true,
				placeHolder: "git repo url",
				title: "Enter a Git repository url",
			});
		}
		if (!repoUrl)
			return;

		const urlSegments = repoUrl.split("/");
		const packageName = await vs.window.showInputBox({
			ignoreFocusOut: true,
			placeHolder: "package name",
			title: "Enter the Packages name",
			value: urlSegments[urlSegments.length - 1],
		});
		if (!packageName)
			return;

		const repoRef = await vs.window.showInputBox({
			ignoreFocusOut: true,
			placeHolder: "commit/branch",
			title: "Enter the commit/branch to use (press <enter> for default)",
		});

		const repoPath = await vs.window.showInputBox({
			ignoreFocusOut: true,
			placeHolder: "path to package",
			title: "Enter the path to the package in the repository (press <enter> for default)",
		});

		return {
			marker: "GIT",
			packageName,
			path: repoPath,
			ref: repoRef,
			url: repoUrl,
		};
	}

	private getPackageEntries(prefix?: string): PickablePackage[] {
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

		const pickablePackageNames = Array.from(matches).map((packageName) => ({
			label: packageName,
			packageName,
		} as PickablePackage));

		if (prefix) {
			return pickablePackageNames;
		} else {
			return [
				{
					description: "add a package from a local path",
					label: "Local Path Package",
					marker: "PATH",

				},
				{
					description: "add a package from a Git repository",
					label: "Git Repository URL",
					marker: "GIT",
				},
				...pickablePackageNames,
			];
		}

	}
}

export type PickablePackage = vs.QuickPickItem & (PubPackage | LocalPubPackageMarker | GitPubPackageMarker);
export type PackageInfo = PubPackage | PathPubPackage | GitPubPackage;


interface PubPackage {
	marker: undefined;
	packageName: string;
}

interface LocalPubPackageMarker { marker: "PATH"; }
interface GitPubPackageMarker { marker: "GIT"; }

interface PathPubPackage extends LocalPubPackageMarker {
	path: string;
	packageName: string;
}

interface GitPubPackage extends GitPubPackageMarker {
	url: string;
	packageName: string;
	ref?: string;
	path?: string;
}
