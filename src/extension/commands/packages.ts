import * as path from "path";
import * as vs from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { isDartCodeTestRun, iUnderstandAction, tenSecondsInMs } from "../../shared/constants";
import { DartWorkspaceContext, Logger } from "../../shared/interfaces";
import { RunProcessResult } from "../../shared/processes";
import { uniq } from "../../shared/utils";
import { fsPath, touchFile } from "../../shared/utils/fs";
import { getPubWorkspaceStatus, isValidPubGetTarget, promptToRunPubGet, promptToRunPubUpgrade, runPubGet } from "../../shared/vscode/pub";
import { getAllProjectFolders } from "../../shared/vscode/utils";
import { Context } from "../../shared/vscode/workspace";
import { config } from "../config";
import * as util from "../utils";
import { getExcludedFolders } from "../utils";
import { getFolderToRunCommandIn } from "../utils/vscode/projects";
import { runBatchFolderOperation } from "./batch_progress";
import { BaseSdkCommands, commandState, OperationProgress } from "./sdk";

let isFetchingPackages = false;
let runPubGetDelayTimer: NodeJS.Timeout | undefined;

/// The reason for the last pubspec save. Resets to undefined after 1s so can
/// be used to tell if a watcher event was likely the result of an explicit in-IDE
/// save versus modified externally.
let lastPubspecSaveReason: vs.TextDocumentSaveReason | undefined;

export class PackageCommands extends BaseSdkCommands {
	constructor(logger: Logger, context: Context, workspace: DartWorkspaceContext, dartCapabilities: DartCapabilities) {
		super(logger, context, workspace, dartCapabilities);
		this.disposables.push(vs.commands.registerCommand("dart.getPackages", this.getPackages.bind(this)));
		this.disposables.push(vs.commands.registerCommand("dart.getPackages.all", this.getPackagesForAllProjects.bind(this)));
		this.disposables.push(vs.commands.registerCommand("dart.listOutdatedPackages", this.listOutdatedPackages.bind(this)));
		this.disposables.push(vs.commands.registerCommand("dart.upgradePackages", this.upgradePackages.bind(this)));
		this.disposables.push(vs.commands.registerCommand("dart.upgradePackages.majorVersions", this.upgradePackagesMajorVersions.bind(this)));

		// Pub commands.
		this.disposables.push(vs.commands.registerCommand("pub.get", (selection) => vs.commands.executeCommand("dart.getPackages", selection)));
		this.disposables.push(vs.commands.registerCommand("pub.get.all", (selection) => vs.commands.executeCommand("dart.getPackages.all", selection)));
		this.disposables.push(vs.commands.registerCommand("pub.upgrade", (selection) => vs.commands.executeCommand("dart.upgradePackages", selection)));
		this.disposables.push(vs.commands.registerCommand("pub.upgrade.majorVersions", (selection) => vs.commands.executeCommand("dart.upgradePackages.majorVersions", selection)));
		this.disposables.push(vs.commands.registerCommand("pub.outdated", (selection) => vs.commands.executeCommand("dart.listOutdatedPackages", selection)));

		// Flutter commands.
		this.disposables.push(vs.commands.registerCommand("flutter.packages.get", (selection) => vs.commands.executeCommand("dart.getPackages", selection)));
		this.disposables.push(vs.commands.registerCommand("flutter.packages.get.all", (selection) => vs.commands.executeCommand("dart.getPackages.all", selection)));
		this.disposables.push(vs.commands.registerCommand("flutter.packages.upgrade", (selection) => vs.commands.executeCommand("dart.upgradePackages", selection)));
		this.disposables.push(vs.commands.registerCommand("flutter.packages.upgrade.majorVersions", (selection) => vs.commands.executeCommand("dart.upgradePackages.majorVersions", selection)));
		this.disposables.push(vs.commands.registerCommand("flutter.packages.outdated", (selection) => vs.commands.executeCommand("dart.listOutdatedPackages", selection)));

		// Hook saving pubspec to run pub.get.
		this.setupPubspecWatcher();
	}

	/// Touches pubspec.lock and .dart_tool/package_config.json to update their modification times.
	/// This is a workaround for https://github.com/Dart-Code/Dart-Code/issues/5549.
	private touchPubFiles(uri: vs.Uri): void {
		const folder = fsPath(uri);
		touchFile(path.join(folder, "pubspec.lock"));
		touchFile(path.join(folder, ".dart_tool", "package_config.json"));
	}

	private async getPackages(
		uri: string | vs.Uri | vs.Uri[] | undefined,
		operationProgress?: OperationProgress,
	): Promise<RunProcessResult | undefined> {
		if (!config.enablePub)
			return;

		// If we don't have a parent progress, add one.
		if (!operationProgress) {
			return vs.window.withProgress({
				cancellable: true,
				location: vs.ProgressLocation.Notification,
				title: "pub get",
			}, (progress, token) => this.getPackages(uri, { progressReporter: progress, cancellationToken: token }));
		}

		// If we are a batch, run for each item.
		if (Array.isArray(uri)) {
			const uris = uri.map((item) => typeof item === "string" ? vs.Uri.file(item) : item);
			await runBatchFolderOperation(uris, operationProgress, this.getPackagesForUri.bind(this));
			return;
		}

		const resolvedUri = await this.resolvePackageTargetUri(uri, "Select which folder to get packages for");
		if (!resolvedUri)
			return;

		return this.getPackagesForUri(resolvedUri, operationProgress);
	}

	private async getPackagesForUri(uri: vs.Uri, operationProgress?: OperationProgress) {
		// Exclude folders we should never run pub get for.
		if (!isValidPubGetTarget(uri).valid)
			return;

		const additionalArgs: string[] = [];
		if (config.offline)
			additionalArgs.push("--offline");
		if (this.dartCapabilities.needsNoExampleForPubGet)
			additionalArgs.push("--no-example");

		let result: RunProcessResult | undefined;
		if (util.isInsideFlutterProject(uri))
			result = await this.runFlutter(["pub", "get", ...additionalArgs], uri, false, operationProgress);
		else
			result = await this.runPub(["get", ...additionalArgs], uri, false, operationProgress);

		// Touch the files to update their modification times.
		// This is a workaround for https://github.com/Dart-Code/Dart-Code/issues/5549.
		if (result?.exitCode === 0 && this.dartCapabilities.requiresTouchAfterPubGet)
			this.touchPubFiles(uri);

		return result;
	}

	private async getPackagesForAllProjects() {
		if (!config.enablePub)
			return;

		const allFolders = await getAllProjectFolders(this.logger, getExcludedFolders, { requirePubspec: true, sort: true, searchDepth: config.projectSearchDepth });
		const uriFolders = allFolders.map((f) => vs.Uri.file(f));
		await vs.commands.executeCommand("dart.getPackages", uriFolders);
	}

	private async listOutdatedPackages(uri: string | vs.Uri | undefined) {
		if (!config.enablePub)
			return;

		if (!uri || !(uri instanceof vs.Uri)) {
			uri = await getFolderToRunCommandIn(this.logger, "Select which folder to check for outdated packages");
			// If the user cancelled, bail out (otherwise we'll prompt them again below).
			if (!uri)
				return;
		}
		if (typeof uri === "string")
			uri = vs.Uri.file(uri);

		if (util.isInsideFlutterProject(uri))
			return this.runFlutter(["pub", "outdated"], uri, true);
		else
			return this.runPub(["outdated"], uri, true);
	}

	private async upgradePackages(
		uri: string | vs.Uri | vs.Uri[] | undefined,
		operationProgress?: OperationProgress
	): Promise<RunProcessResult | undefined> {
		if (!config.enablePub)
			return;

		// If we don't have a parent progress, add one.
		if (!operationProgress) {
			return vs.window.withProgress({
				cancellable: true,
				location: vs.ProgressLocation.Notification,
				title: "pub upgrade",
			}, (progress, token) => this.upgradePackages(uri, { progressReporter: progress, cancellationToken: token }));
		}

		// If we are a batch, run for each item.
		if (Array.isArray(uri)) {
			const uris = uri.map((item) => typeof item === "string" ? vs.Uri.file(item) : item);
			await runBatchFolderOperation(uris, operationProgress, this.upgradePackagesForUri.bind(this));
			return;
		}

		const resolvedUri = await this.resolvePackageTargetUri(uri, "Select which folder to upgrade packages in");
		if (!resolvedUri)
			return;

		return this.upgradePackagesForUri(resolvedUri, operationProgress);
	}

	private async upgradePackagesForUri(uri: vs.Uri, operationProgress?: OperationProgress) {
		// Exclude folders we should never run pub get for.
		if (!isValidPubGetTarget(uri).valid)
			return;

		if (util.isInsideFlutterProject(uri))
			return this.runFlutter(["pub", "upgrade"], uri, false, operationProgress);
		else
			return this.runPub(["upgrade"], uri, false, operationProgress);
	}

	private async resolvePackageTargetUri(uri: string | vs.Uri | undefined, placeHolder: string): Promise<vs.Uri | undefined> {
		if (!uri || !(uri instanceof vs.Uri)) {
			const folder = await getFolderToRunCommandIn(this.logger, placeHolder);
			if (!folder)
				return; // User cancelled.
			return vs.Uri.file(folder);
		}

		return uri;
	}

	private async upgradePackagesMajorVersions(uri: string | vs.Uri | undefined) {
		if (!config.enablePub)
			return;

		if (!this.context.hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation) {
			const resp = await vs.window.showWarningMessage("Running 'pub get --major-versions' will update your pubspec.yaml to match the 'resolvable' column reported in 'pub outdated'", iUnderstandAction);
			if (resp !== iUnderstandAction) {
				return;
			}
			this.context.hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation = true;
		}

		if (!uri || !(uri instanceof vs.Uri)) {
			uri = await getFolderToRunCommandIn(this.logger, "Select which folder to upgrade packages --major-versions in");
			// If the user cancelled, bail out (otherwise we'll prompt them again below).
			if (!uri)
				return;
		}
		if (typeof uri === "string")
			uri = vs.Uri.file(uri);
		if (util.isInsideFlutterProject(uri))
			return this.runFlutter(["pub", "upgrade", "--major-versions"], uri);
		else
			return this.runPub(["upgrade", "--major-versions"], uri);
	}

	private setupPubspecWatcher() {
		// Create the watcher regardless of enablePub setting, because the handler will check
		// and then we don't have to create/destroy as settings change.
		this.disposables.push(vs.workspace.onWillSaveTextDocument((e) => {
			const name = path.basename(fsPath(e.document.uri)).toLowerCase();
			if (name === "pubspec.yaml" || name === "pubspec_overrides.yaml") {
				lastPubspecSaveReason = e.reason;
				setTimeout(() => lastPubspecSaveReason = undefined, 1000);
			}
		}));
		const watcher = vs.workspace.createFileSystemWatcher("**/pubspec{,_overrides}.yaml");
		this.disposables.push(watcher);
		watcher.onDidChange(this.handlePubspecChange.bind(this));
		watcher.onDidCreate(this.handlePubspecChange.bind(this));
	}

	private handlePubspecChange(uri: vs.Uri) {
		if (!config.enablePub)
			return;

		const isManualSave = !!lastPubspecSaveReason;
		const filePath = fsPath(uri);

		// Never do anything for files inside hidden or build folders.
		if (filePath.includes(`${path.sep}.`) || (!isManualSave && filePath.includes(`${path.sep}build${path.sep}`))) {
			this.logger.info(`Skipping pubspec change for ignored folder ${filePath}`);
			return;
		}

		this.logger.info(`Pubspec ${filePath} was modified`);
		const conf = config.for(uri);

		// Don't do anything if we're disabled.
		if (conf.runPubGetOnPubspecChanges === "never") {
			this.logger.info(`Automatically running "pub get" is disabled`);
			return;
		}

		// Or if the workspace config says we shouldn't run.
		if (this.workspace.config.disableAutomaticPub) {
			this.logger.info(`Workspace suppresses automatic "pub"`);
			return;
		}

		// Don't do anything if we're in the middle of creating projects, as packages
		// may  be fetched automatically.
		if (commandState.numProjectCreationsInProgress > 0) {
			this.logger.info("Skipping package fetch because project creation is in progress");
			return;
		}

		// Cancel any existing delayed timer.
		if (runPubGetDelayTimer) {
			clearTimeout(runPubGetDelayTimer);
		}

		// If the save was triggered by one of the auto-save options, then debounce longer.
		const debounceDuration = lastPubspecSaveReason === vs.TextDocumentSaveReason.FocusOut
			|| lastPubspecSaveReason === vs.TextDocumentSaveReason.AfterDelay
			? (isDartCodeTestRun ? 3000 : 10000)
			: 1000;

		const projectUri = vs.Uri.file(path.dirname(filePath));
		runPubGetDelayTimer = setTimeout(() => {
			runPubGetDelayTimer = undefined;
			lastPubspecSaveReason = undefined;
			void this.fetchPackagesOrPrompt(projectUri, { alwaysPrompt: conf.runPubGetOnPubspecChanges === "prompt" });
		}, debounceDuration); // TODO: Does this need to be configurable?
	}

	public async fetchPackagesOrPrompt(uri: vs.Uri | undefined, options?: { alwaysPrompt?: boolean, upgradeOnSdkChange?: boolean }): Promise<void> {
		if (!config.enablePub)
			return;

		if (isFetchingPackages) {
			this.logger.info(`Already running pub get, skipping!`);
			return;
		}
		isFetchingPackages = true;
		// VS Code will hide any prompt after 10seconds, so if the user didn't respond within 10s we assume this prompt is not
		// going to be responded to and should clear the flag to avoid run-pub-get-on-save not working.
		setTimeout(() => isFetchingPackages = false, tenSecondsInMs);

		// TODO: Extract this into a Pub class with the things in pub.ts.

		try {
			const forcePrompt = options?.alwaysPrompt;
			// We debounced so we might get here and have multiple projects to fetch for
			// for ex. when we change Git branch we might change many files at once. So
			// check how many there are, and if there are:
			//   0 - then just use Uri
			//   1 - then just do that one
			//   more than 1 - prompt to do all
			const projectFolders = await getAllProjectFolders(this.logger, util.getExcludedFolders, { requirePubspec: true, searchDepth: config.projectSearchDepth });
			const pubStatuses = getPubWorkspaceStatus(
				this.sdks,
				this.logger,
				uniq(projectFolders).map((p) => vs.Uri.file(p)).filter((uri) => config.for(uri).promptToGetPackages)
			)
				.filter((result) => result.pubRequired);
			this.logger.info(`Found pub status for ${pubStatuses.length} folders:${pubStatuses.map((result) => `\n    ${fsPath(result.folderUri)} (pubRequired?: ${result.pubRequired}, reason: ${result.reason})`).join("")}`);

			const someProjectsRequirePubUpgrade = pubStatuses.some((result) => result.pubRequired === "UPGRADE");
			const projectsRequiringPub = pubStatuses.map((result) => result.folderUri);

			if (options?.upgradeOnSdkChange && someProjectsRequirePubUpgrade)
				await promptToRunPubUpgrade(projectsRequiringPub);
			else if (!forcePrompt && projectsRequiringPub.length === 0 && uri)
				await this.runPubGetWithRelatives(projectFolders, uri);
			else if (!forcePrompt && projectsRequiringPub.length === 1)
				await this.runPubGetWithRelatives(projectFolders, projectsRequiringPub[0]);
			else if (projectsRequiringPub.length)
				await promptToRunPubGet(projectsRequiringPub);
		} finally {
			isFetchingPackages = false;
		}
	}

	private async runPubGetWithRelatives(allProjectFolders: string[], triggeredProjectUri: vs.Uri) {
		const triggeredProjectFolder = fsPath(triggeredProjectUri);

		const walkDirection = config.runPubGetOnNestedProjects;

		const fetchBoth = walkDirection === "both";
		const fetchUp = walkDirection === "above" || fetchBoth;
		const fetchDown = walkDirection === "below" || fetchBoth;
		let projectsToFetch = [triggeredProjectFolder];
		if (walkDirection) {
			for (const projectFolder of allProjectFolders) {
				if (fetchUp && triggeredProjectFolder.startsWith(projectFolder))
					projectsToFetch.push(projectFolder);
				if (fetchDown && projectFolder.startsWith(triggeredProjectFolder))
					projectsToFetch.push(projectFolder);
			}
		}

		projectsToFetch = uniq(projectsToFetch);
		await runPubGet(projectsToFetch.map((path) => vs.Uri.file(path)));
	}
}
