import * as path from "path";
import * as vs from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { iUnderstandAction, tenSecondsInMs } from "../../shared/constants";
import { DartWorkspaceContext, Logger } from "../../shared/interfaces";
import { uniq } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { getPubPackageStatus, promptToRunPubGet, promptToRunPubUpgrade, runPubGet } from "../../shared/vscode/pub";
import { getAllProjectFolders } from "../../shared/vscode/utils";
import { Context } from "../../shared/vscode/workspace";
import { config } from "../config";
import * as util from "../utils";
import { getFolderToRunCommandIn } from "../utils/vscode/projects";
import { BaseSdkCommands, commandState } from "./sdk";

let isFetchingPackages = false;
let runPubGetDelayTimer: NodeJS.Timeout | undefined;
let lastPubspecSaveReason: vs.TextDocumentSaveReason | undefined;

export class PackageCommands extends BaseSdkCommands {
	constructor(logger: Logger, context: Context, workspace: DartWorkspaceContext, dartCapabilities: DartCapabilities) {
		super(logger, context, workspace, dartCapabilities);
		this.disposables.push(vs.commands.registerCommand("dart.getPackages", this.getPackages, this));
		this.disposables.push(vs.commands.registerCommand("dart.listOutdatedPackages", this.listOutdatedPackages, this));
		this.disposables.push(vs.commands.registerCommand("dart.upgradePackages", this.upgradePackages, this));
		this.disposables.push(vs.commands.registerCommand("dart.upgradePackages.majorVersions", this.upgradePackagesMajorVersions, this));

		// Pub commands.
		this.disposables.push(vs.commands.registerCommand("pub.get", (selection) => vs.commands.executeCommand("dart.getPackages", selection)));
		this.disposables.push(vs.commands.registerCommand("pub.upgrade", (selection) => vs.commands.executeCommand("dart.upgradePackages", selection)));
		this.disposables.push(vs.commands.registerCommand("pub.upgrade.majorVersions", (selection) => vs.commands.executeCommand("dart.upgradePackages.majorVersions", selection)));
		this.disposables.push(vs.commands.registerCommand("pub.outdated", (selection) => vs.commands.executeCommand("dart.listOutdatedPackages", selection)));

		// Flutter commands.
		this.disposables.push(vs.commands.registerCommand("flutter.packages.get", (selection) => vs.commands.executeCommand("dart.getPackages", selection)));
		this.disposables.push(vs.commands.registerCommand("flutter.packages.upgrade", (selection) => vs.commands.executeCommand("dart.upgradePackages", selection)));
		this.disposables.push(vs.commands.registerCommand("flutter.packages.upgrade.majorVersions", (selection) => vs.commands.executeCommand("dart.upgradePackages.majorVersions", selection)));
		this.disposables.push(vs.commands.registerCommand("flutter.packages.outdated", (selection) => vs.commands.executeCommand("dart.listOutdatedPackages", selection)));

		// Hook saving pubspec to run pub.get.
		this.setupPubspecWatcher();
	}

	private async getPackages(uri: string | vs.Uri | vs.Uri[] | undefined) {
		if (Array.isArray(uri)) {
			for (const item of uri) {
				await this.getPackages(item);
			}
			return;
		}

		if (!uri || !(uri instanceof vs.Uri)) {
			uri = await getFolderToRunCommandIn(this.logger, "Select which folder to get packages for");
			// If the user cancelled, bail out (otherwise we'll prompt them again below).
			if (!uri)
				return;
		}
		if (typeof uri === "string")
			uri = vs.Uri.file(uri);

		const additionalArgs = [];
		if (config.offline)
			additionalArgs.push("--offline");
		if (this.dartCapabilities.needsNoExampleForPubGet)
			additionalArgs.push("--no-example");

		if (util.isInsideFlutterProject(uri)) {
			return this.runFlutter(["pub", "get", ...additionalArgs], uri);
		} else {
			return this.runPub(["get", ...additionalArgs], uri);
		}
	}

	private async listOutdatedPackages(uri: string | vs.Uri | undefined) {
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

	private async upgradePackages(uri: string | vs.Uri | vs.Uri[] | undefined) {
		if (Array.isArray(uri)) {
			for (const item of uri) {
				await this.upgradePackages(item);
			}
			return;
		}

		if (!uri || !(uri instanceof vs.Uri)) {
			uri = await getFolderToRunCommandIn(this.logger, "Select which folder to upgrade packages in");
			// If the user cancelled, bail out (otherwise we'll prompt them again below).
			if (!uri)
				return;
		}
		if (typeof uri === "string")
			uri = vs.Uri.file(uri);
		if (util.isInsideFlutterProject(uri))
			return this.runFlutter(["pub", "upgrade"], uri);
		else
			return this.runPub(["upgrade"], uri);
	}

	private async upgradePackagesMajorVersions(uri: string | vs.Uri | undefined) {
		if (!this.dartCapabilities.supportsPubUpgradeMajorVersions) {
			void vs.window.showErrorMessage("Your current Dart SDK does not support 'pub upgrade --major-versions'");
			return;
		}

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
		this.disposables.push(vs.workspace.onWillSaveTextDocument((e) => {
			const name = path.basename(fsPath(e.document.uri)).toLowerCase();
			if (name === "pubspec.yaml" || name === "pubspec_overrides.yaml")
				lastPubspecSaveReason = e.reason;
		}));
		const watcher = vs.workspace.createFileSystemWatcher("**/pubspec{,_overrides}.yaml");
		this.disposables.push(watcher);
		watcher.onDidChange(this.handlePubspecChange, this);
		watcher.onDidCreate(this.handlePubspecChange, this);
	}

	private handlePubspecChange(uri: vs.Uri) {
		const filePath = fsPath(uri);

		// Never do anything for files inside hidden or build folders.
		if (filePath.includes(`${path.sep}.`) || filePath.includes(`${path.sep}build${path.sep}`)) {
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
		if (this.workspace.config.disableAutomaticPackageGet) {
			this.logger.info(`Workspace suppresses automatic "pub get"`);
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
			? 10000
			: 1000;

		const projectUri = vs.Uri.file(path.dirname(filePath));
		runPubGetDelayTimer = setTimeout(() => {
			runPubGetDelayTimer = undefined;
			lastPubspecSaveReason = undefined;
			void this.fetchPackagesOrPrompt(projectUri, { alwaysPrompt: conf.runPubGetOnPubspecChanges === "prompt" });
		}, debounceDuration); // TODO: Does this need to be configurable?
	}

	public async fetchPackagesOrPrompt(uri: vs.Uri | undefined, options?: { alwaysPrompt?: boolean, upgradeOnSdkChange?: boolean }): Promise<void> {
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
			const forcePrompt = options && options.alwaysPrompt;
			// We debounced so we might get here and have multiple projects to fetch for
			// for ex. when we change Git branch we might change many files at once. So
			// check how many there are, and if there are:
			//   0 - then just use Uri
			//   1 - then just do that one
			//   more than 1 - prompt to do all
			const projectFolders = await getAllProjectFolders(this.logger, util.getExcludedFolders, { requirePubspec: true, searchDepth: config.projectSearchDepth });
			const pubStatuses = uniq(projectFolders)
				.map(vs.Uri.file)
				.filter((uri) => config.for(uri).promptToGetPackages)
				.map((uri) => ({ uri, status: getPubPackageStatus(this.sdks, this.logger, uri) }))
				.filter((result) => result.status !== undefined);
			this.logger.info(`Found ${pubStatuses.length} folders requiring "pub get" or "pub upgrade":${pubStatuses.map((result) => `\n    ${fsPath(result.uri)} (get: ${result.status?.probablyRequiresGet}, upgrade: ${result.status?.probablyRequiresUpgrade}, reason: ${result.status?.reason})`).join("")}`);

			const someProjectsRequirePubUpgrade = pubStatuses.some((result) => result.status?.probablyRequiresUpgrade);
			const projectsRequiringPub = pubStatuses.map((result) => result.uri);

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
