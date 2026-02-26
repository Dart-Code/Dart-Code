import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { commands, ExtensionContext, extensions, ProgressLocation, Uri, window, workspace } from "vscode";
import { analyzerSnapshotPath, cloningFlutterMessage, DART_DOWNLOAD_URL, dartPlatformName, dartVMPath, executableNames, ExtensionRestartReason, FLUTTER_CREATE_PROJECT_TRIGGER_FILE, FLUTTER_DOWNLOAD_URL, flutterPath, isLinux, MISSING_VERSION_FILE_VERSION, openSettingsAction, SdkTypeString, showLogAction } from "../../shared/constants";
import { GetSDKCommandConfig, GetSDKCommandResult, Logger, SdkSearchResult, SdkSearchResults, WorkspaceConfig, WritableWorkspaceConfig } from "../../shared/interfaces";
import { flatMap, isDartSdkFromFlutter, notUndefined } from "../../shared/utils";
import { existsAndIsDirectorySync, existsAndIsFileSync, extractFlutterSdkPathFromPackagesFile, fsPath, getSdkVersion, hasPubspec, projectReferencesFlutter, safeRealpathSync } from "../../shared/utils/fs";
import { resolvedPromise } from "../../shared/utils/promises";
import { processBazelWorkspace, processDartSdkRepository, processFuchsiaWorkspace } from "../../shared/utils/workspace";
import { envUtils, getAllProjectFolders, getDartWorkspaceFolders, resolvePaths } from "../../shared/vscode/utils";
import { WorkspaceContext } from "../../shared/workspace";
import { Analytics, CloneSdkResult } from "../analytics";
import { AddSdkToPath } from "../commands/add_sdk_to_path";
import { config } from "../config";
import { ringLog } from "../extension";
import { getExcludedFolders, openLogContents, promptToReloadExtension } from "../utils";
import { runToolProcess } from "../utils/processes";
import { initializeFlutterSdk } from "./flutter";

// TODO: Tidy this class up (it exists mainly to share logger).
export class SdkUtils {
	constructor(private readonly logger: Logger, private readonly context: ExtensionContext, private readonly analytics: Analytics) { }

	public handleMissingSdks(workspaceContext: WorkspaceContext) {
		const context = this.context;
		// Note: This code only runs if we fail to find the Dart SDK, or fail to find the Flutter SDK
		// and are in a Flutter project. In the case where we fail to find the Flutter SDK but are not
		// in a Flutter project (eg. we ran Flutter Doctor without the extension activated) then
		// this code will not be run as the extension will activate normally, and then the command-handling
		// code for each command will detect the missing Flutter SDK and respond appropriately.
		context.subscriptions.push(commands.registerCommand("flutter.createProject", () => {
			this.showRelevantActivationFailureMessage(workspaceContext, true, "flutter.createProject");
		}));
		context.subscriptions.push(commands.registerCommand("dart.createProject", () => {
			this.showRelevantActivationFailureMessage(workspaceContext, false, "dart.createProject");
		}));
		context.subscriptions.push(commands.registerCommand("_dart.flutter.createSampleProject", () => {
			this.showRelevantActivationFailureMessage(workspaceContext, true, "_dart.flutter.createSampleProject");
		}));
		context.subscriptions.push(commands.registerCommand("flutter.doctor", () => {
			this.showRelevantActivationFailureMessage(workspaceContext, true, "flutter.doctor");
		}));
		context.subscriptions.push(commands.registerCommand("flutter.upgrade", () => {
			this.showRelevantActivationFailureMessage(workspaceContext, true, "flutter.upgrade");
		}));
		// Wait a while before showing the error to allow the code above to have run if it will.
		setTimeout(() => {
			// Only show the "startup" message if we didn't already show another message as
			// a result of one of the above commands beinv invoked.
			if (!this.hasShownActivationFailure) {
				if (workspaceContext.hasAnyFlutterProjects) {
					this.showRelevantActivationFailureMessage(workspaceContext, true);
				} else if (workspaceContext.hasAnyStandardDartProjects) {
					this.showRelevantActivationFailureMessage(workspaceContext, false);
				} else {
					this.logger.error("No Dart or Flutter SDK was found. Suppressing prompt because it doesn't appear that a Dart/Flutter project is open.");
				}
			}
		}, 500);
		return;
	}

	private hasShownActivationFailure = false;
	private showRelevantActivationFailureMessage(workspaceContext: WorkspaceContext, isFlutter: boolean, commandToReRun?: string) {
		if (isFlutter && workspaceContext.sdks.flutter && !workspaceContext.sdks.dart) {
			this.showFluttersDartSdkActivationFailure();
		} else if (isFlutter) {
			this.showFlutterActivationFailure(commandToReRun);
		} else {
			this.showDartActivationFailure(commandToReRun);
		}
		if (!this.hasShownActivationFailure) {
			this.analytics.logSdkDetectionFailure();
			this.hasShownActivationFailure = true;
		}
	}

	public showFluttersDartSdkActivationFailure() {
		void promptToReloadExtension(this.logger, {
			prompt: "Could not find Dart in your Flutter SDK. Please run 'flutter doctor' in the terminal then reload the project once all issues are resolved.",
			buttonText: "Reload",
			offerLog: true,
			restartReason: ExtensionRestartReason.FlutterSdkActivationFailure,
		},
		);
	}
	public showFlutterActivationFailure(commandToReRun?: string) {
		void this.showSdkActivationFailure(
			"Flutter",
			(p) => this.findFlutterSdk(p),
			FLUTTER_DOWNLOAD_URL,
			(p) => config.setGlobalFlutterSdkPath(p),
			commandToReRun,
		);
	}
	public showDartActivationFailure(commandToReRun?: string) {
		void this.showSdkActivationFailure(
			"Dart",
			(p) => this.findDartSdk(p),
			DART_DOWNLOAD_URL,
			(p) => config.setGlobalDartSdkPath(p),
			commandToReRun,
		);
	}

	public async showSdkActivationFailure(
		sdkType: SdkTypeString,
		search: (path: string[]) => SdkSearchResults,
		downloadUrl: string,
		saveSdkPath: (path: string) => Thenable<void>,
		commandToReRun?: string,
	) {
		const downloadAction = "Download SDK";
		const locateAction = "Locate SDK";
		let displayMessage = `Could not find a ${sdkType} SDK. Please download, or, if already downloaded, click '${locateAction}'.`;
		outer:
		while (true) {
			const ringLogContents = ringLog.toString();
			const selectedItem = await window.showErrorMessage(displayMessage,
				downloadAction,
				locateAction,
				showLogAction,
			);
			// TODO: Refactor/reformat/comment this code - it's messy and hard to understand!
			if (selectedItem === locateAction) {
				const selectedFolders =
					await window.showOpenDialog({ canSelectFolders: true, openLabel: `Set ${sdkType} SDK folder` });
				if (selectedFolders && selectedFolders.length > 0) {
					const matchingSdkFolder = search(selectedFolders.map((f) => fsPath(f)));
					if (matchingSdkFolder.sdkPath) {
						await saveSdkPath(matchingSdkFolder.sdkPath);
						await promptToReloadExtension(this.logger, { restartReason: ExtensionRestartReason.LocatedSdk });
						if (commandToReRun) {
							void commands.executeCommand(commandToReRun);
						}
						break;
					} else {
						displayMessage = `That folder does not appear to be a ${sdkType} SDK.`;
					}
				}
			} else if (selectedItem === downloadAction) {
				if (sdkType === "Flutter") {
					const cloneResult = await this.tryFlutterCloneIfGitAvailable(commandToReRun);
					switch (cloneResult) {
						case CloneSdkResult.succeeded:
							break outer;
						case CloneSdkResult.cancelled:
							break;
						case CloneSdkResult.noGit:
							if (await window.showErrorMessage("Unable to clone Flutter because Git was not found. Please clone or download the Flutter SDK manually.", "Setup Instructions"))
								await envUtils.openInBrowser(downloadUrl);
							break;
						case CloneSdkResult.failed:
							if (await window.showErrorMessage("Failed to clone Flutter using Git. Please clone or download the Flutter SDK manually.", "Setup Instructions"))
								await envUtils.openInBrowser(downloadUrl);
							break;
					}
				} else {
					await envUtils.openInBrowser(downloadUrl);
					break;
				}
			} else if (selectedItem === showLogAction) {
				void openLogContents(undefined, ringLogContents);
				break;
			} else {
				break;
			}
		}
	}

	private async tryFlutterCloneIfGitAvailable(commandToReRun: string | undefined): Promise<CloneSdkResult> {
		let gitExecutable = "git";

		const gitAvailable: GitOperationResult = await window.withProgress({
			cancellable: true,
			location: ProgressLocation.Notification,
			title: "Checking for git",
		}, async (_, cancellationToken): Promise<GitOperationResult> => {
			try {
				// First try to find git from VS Code. It searches both PATH and some other well-known
				// locations.
				try {
					const gitExtension = extensions.getExtension("vscode.git");
					// If the extension isn't already activated, probably it's disabled or the user isn't
					// using it.
					if (gitExtension?.isActive) {
						const gitApi = gitExtension.exports.getAPI(1);
						const gitApiPath = gitApi?.git.path;
						if (gitApiPath)
							gitExecutable = gitApiPath;
					}
				} catch {
					// Could be that Git extension is disabled or "git.enabled" setting is false.
				}

				const gitProc = await runToolProcess(this.logger, undefined, gitExecutable, ["--version"], undefined, cancellationToken);
				if (cancellationToken.isCancellationRequested)
					return GitOperationResult.cancelled;
				if (gitProc.exitCode !== 0) {
					this.logger.error(`Failed to run "git --version" to detect git, so skipping "Clone Flutter SDK" workflow:\n`
						+ `Exit code: ${gitProc.exitCode}\n`
						+ `stdout: ${gitProc.stdout}\n`
						+ `stderr: ${gitProc.stderr}\n`);
					return GitOperationResult.error;
				}
			} catch (e) {
				if (cancellationToken.isCancellationRequested)
					return GitOperationResult.cancelled;
				this.logger.error(`Failed to run "git --version" to detect git, so skipping "Clone Flutter SDK" workflow: ${e}`);
				return GitOperationResult.error;
			}
			return GitOperationResult.success;
		});

		if (gitAvailable !== GitOperationResult.success) {
			const result = gitAvailable === GitOperationResult.cancelled
				? CloneSdkResult.cancelled
				: CloneSdkResult.noGit;
			this.analytics.logGitCloneSdk(result);
			return result;
		}

		const cloneResult = await this.promptForFlutterClone(gitExecutable);
		const flutterSdkFolder = cloneResult.folder;
		if (!flutterSdkFolder)
			return cloneResult.result;

		await config.setGlobalFlutterSdkPath(flutterSdkFolder);
		await initializeFlutterSdk(this.logger, path.join(flutterSdkFolder, flutterPath));

		await new AddSdkToPath(this.logger, this.context, this.analytics).promptToAddToPath("Flutter", flutterSdkFolder);

		await commands.executeCommand("_dart.reloadExtension", ExtensionRestartReason.AfterFlutterClone);
		if (commandToReRun)
			void commands.executeCommand(commandToReRun);

		return CloneSdkResult.succeeded;

	}

	private async promptForFlutterClone(gitExecutable: string): Promise<{ folder?: string, result: CloneSdkResult }> {
		const selectedFolders =
			await window.showOpenDialog({
				defaultUri: Uri.file(os.homedir()),
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: `Clone Flutter`,
				title: "Select Folder for Flutter SDK",
			});
		if (selectedFolders?.length === 1) {
			const workingDirectory = fsPath(selectedFolders[0]);
			const cloneResult = await this.cloneFlutterWithProgress(gitExecutable, workingDirectory);
			const didClone = cloneResult === GitOperationResult.success;

			const result = cloneResult === GitOperationResult.success
				? CloneSdkResult.succeeded
				: cloneResult === GitOperationResult.cancelled
					? CloneSdkResult.cancelled
					: CloneSdkResult.failed;
			this.analytics.logGitCloneSdk(result);

			return { result, folder: didClone ? path.join(workingDirectory, "flutter") : undefined };
		}

		return { result: CloneSdkResult.cancelled };
	}

	private async cloneFlutterWithProgress(gitExecutable: string, workingDirectory: string): Promise<GitOperationResult> {
		const gitUrl = "https://github.com/flutter/flutter.git";

		return await window.withProgress({
			cancellable: true,
			location: ProgressLocation.Notification,
			title: cloningFlutterMessage,
		}, async (_, cancellationToken): Promise<GitOperationResult> => {
			try {
				const gitProc = await runToolProcess(this.logger, workingDirectory, gitExecutable, ["clone", "-b", "stable", gitUrl], undefined, cancellationToken);
				if (cancellationToken.isCancellationRequested)
					return GitOperationResult.cancelled;

				if (gitProc.exitCode !== 0) {
					this.logger.error(`Failed to run "git clone" to download Flutter, so skipping "clone Flutter SDK" workflow:\n`
						+ `Exit code: ${gitProc.exitCode}\n`
						+ `stdout: ${gitProc.stdout}\n`
						+ `stderr: ${gitProc.stderr}\n`);

					if (!cancellationToken.isCancellationRequested)
						void window.showErrorMessage(`Failed to clone Flutter: ${gitProc.stderr}`);

					return GitOperationResult.error;
				}

				return GitOperationResult.success;
			} catch (e) {
				if (cancellationToken.isCancellationRequested)
					return GitOperationResult.cancelled;
				this.logger.error(`Failed to run "git clone" to download Flutter, so skipping "clone Flutter SDK" workflow: ${e}`);
				return GitOperationResult.error;
			}
		});
	}

	public async scanWorkspace(): Promise<WorkspaceContext> {
		this.logger.info("Searching for SDKs...");

		const pathOverride = process.env.DART_PATH_OVERRIDE || "";
		const normalPath = process.env.PATH || "";
		const paths = (pathOverride + path.delimiter + normalPath).split(path.delimiter).filter((p) => p);

		// Some paths to search after PATH as a final resort.
		const fallbackSdkSearchPaths = [
			process.env.FLUTTER_ROOT,
			isLinux ? "~/snap/flutter/common/flutter" : undefined,
			"~/flutter-sdk",
			"/google/flutter",
			"/opt/flutter", // https://github.com/Dart-Code/Dart-Code/issues/5174
		];

		this.logger.info("Environment PATH:");
		for (const p of paths)
			this.logger.info(`    ${p}`);

		// If we are running the analyzer remotely over SSH, we only support an analyzer, since none
		// of the other SDKs will work remotely. Also, there is no need to validate the sdk path,
		// since that file will exist on a remote machine.
		if (config.analyzerSshHost) {
			return new WorkspaceContext({
				dart: config.sdkPath,
				dartSdkIsFromFlutter: false,
				flutter: undefined,
				isPreReleaseSdk: false,
			}, {}, false, false, false, false);
		}

		// TODO: This has gotten very messy and needs tidying up...

		let firstFlutterProject: string | undefined;
		let hasAnyFlutterProject = false;
		let hasAnyWebProject = false;
		let hasAnyStandardDartProject = false;

		const possibleProjects = await getAllProjectFolders(this.logger, getExcludedFolders, { searchDepth: config.projectSearchDepth });

		// Scan through them all to figure out what type of projects we have.
		for (const folder of possibleProjects) {
			const hasPubspecFile = hasPubspec(folder);
			const refsFlutter = hasPubspecFile && projectReferencesFlutter(folder);
			const refsWeb = false; // hasPubspecFile && referencesWeb(folder);
			const hasFlutterCreateProjectTriggerFile =
				fs.existsSync(path.join(folder, FLUTTER_CREATE_PROJECT_TRIGGER_FILE));

			// Special case to detect the Flutter repo root, so we always consider it a Flutter project and will use the local SDK
			const isFlutterRepo = fs.existsSync(path.join(folder, "bin/flutter")) && fs.existsSync(path.join(folder, "bin/cache/dart-sdk"));

			// Since we just blocked on a lot of sync FS, yield.
			await resolvedPromise;

			const isSomethingFlutter = refsFlutter || hasFlutterCreateProjectTriggerFile || isFlutterRepo;

			const kind = isSomethingFlutter ? "Flutter" : "non-Flutter";
			this.logger.info(`Found ${kind} project at ${folder} (Pubspec? ${hasPubspecFile}, Mobile? ${refsFlutter}, Create Trigger? ${hasFlutterCreateProjectTriggerFile}, Flutter Repo? ${isFlutterRepo})`);

			// Track the first Flutter Project so we can try finding the Flutter SDK from its packages file.
			firstFlutterProject = firstFlutterProject || (isSomethingFlutter ? folder : undefined);

			// Set some flags we'll use to construct the workspace, so we know what things we need to light up.
			hasAnyFlutterProject = hasAnyFlutterProject || isSomethingFlutter;
			hasAnyWebProject = hasAnyWebProject || refsWeb;
			hasAnyStandardDartProject = hasAnyStandardDartProject || (!isSomethingFlutter && hasPubspecFile);
		}

		// Certain types of workspaces will have special config, so read them here.
		const workspaceConfig: WorkspaceConfig = {};
		// Helper that searches for a specific folder/file up the tree and
		// runs some specific processing.
		const workspaceFolders = getDartWorkspaceFolders();
		const topLevelFolders = workspaceFolders.map((w) => fsPath(w.uri));
		const processWorkspaceType = async (search: (logger: Logger, folder: string) => Promise<string | undefined>, process: (logger: Logger, config: WorkspaceConfig, folder: string) => void): Promise<string | undefined> => {
			for (const folder of topLevelFolders) {
				const root = await search(this.logger, folder);
				if (root) {
					process(this.logger, workspaceConfig, root);
					return root;
				}
			}
			return undefined;
		};

		await processWorkspaceType(findDartSdkRoot, processDartSdkRepository);
		await processWorkspaceType(findBazelWorkspaceRoot, processBazelWorkspace);
		const fuchsiaRoot = await processWorkspaceType(findFuchsiaRoot, processFuchsiaWorkspace);

		if (fuchsiaRoot) {
			this.logger.info(`Found Fuchsia root at ${fuchsiaRoot}`);
			if (hasAnyStandardDartProject)
				this.logger.info(`Found Fuchsia project that is not vanilla Flutter`);
		}

		let flutterSdkPath;
		if (workspaceConfig.forceFlutterWorkspace) {
			hasAnyFlutterProject = true;
			flutterSdkPath = workspaceConfig?.flutterSdkHome;
		} else {
			// User provided custom command to obtain the sdk path
			const flutterSdkPathFromCommand = config.getFlutterSdkCommand && await this.runCustomGetSDKCommand(config.getFlutterSdkCommand, "dart.getFlutterSdkCommand", !!config.workspaceGetFlutterSdkCommand);

			const flutterSdkSearchPaths = [
				config.flutterSdkPath,
				flutterSdkPathFromCommand?.path,
				// TODO: These could move into processFuchsiaWorkspace and be set on the config?
				fuchsiaRoot && path.join(fuchsiaRoot, "lib/flutter"),
				fuchsiaRoot && path.join(fuchsiaRoot, "third_party/dart-pkg/git/flutter"),
				firstFlutterProject,
				firstFlutterProject && extractFlutterSdkPathFromPackagesFile(firstFlutterProject),
				firstFlutterProject && path.join(firstFlutterProject, ".flutter"),
				firstFlutterProject && path.join(firstFlutterProject, "vendor/flutter"),
				...paths,
				...fallbackSdkSearchPaths,
			].filter(notUndefined);

			let flutterSdkResult = this.findFlutterSdk(flutterSdkSearchPaths);
			const sdkInitScript = flutterSdkResult.sdkInitScript;

			// Handle the case where the Flutter snap has not been initialised.
			if (!flutterSdkResult.sdkPath && sdkInitScript && flutterSdkResult.candidatePaths.includes(sdkInitScript)) {
				// Trigger initialization.
				this.logger.info(`No Flutter SDK found, but ${sdkInitScript} looks like an init script so attempting to initialize...`);
				await initializeFlutterSdk(this.logger, sdkInitScript);

				// Then search again.
				this.logger.info(`Snap initialization completed, searching for Flutter SDK again...`);
				flutterSdkResult = this.findFlutterSdk(flutterSdkSearchPaths);
			}

			if (hasAnyFlutterProject) {
				void this.warnIfBadConfigSdk(config.flutterSdkPath, flutterSdkResult, "dart.flutterSdkPath", !!config.workspaceFlutterSdkPath);
			}

			flutterSdkPath = flutterSdkResult.sdkPath;
		}

		// Since we just blocked on a lot of sync FS, yield.
		await resolvedPromise;

		// If we're a Flutter workspace but we couldn't get the version, try running Flutter to initialise it first.
		// Do this before searching for the Dart SDK, as it might download the Dart SDK we'd like to find.
		let hasAttemptedFlutterInitialization = false;
		if (hasAnyFlutterProject && flutterSdkPath && !workspaceConfig.skipFlutterInitialization) {
			const flutterVersion = workspaceConfig?.flutterVersion ?? getSdkVersion(this.logger, { sdkRoot: flutterSdkPath });
			const flutterNeedsInitializing = !flutterVersion
				|| !fs.existsSync(path.join(flutterSdkPath, "bin/cache/dart-sdk"));

			if (flutterNeedsInitializing) {
				hasAttemptedFlutterInitialization = true;
				await initializeFlutterSdk(this.logger, path.join(flutterSdkPath, flutterPath));
			}
		}

		// User provided custom command to obtain the sdk path
		const dartSdkPathFromCommand = config.getDartSdkCommand && await this.runCustomGetSDKCommand(config.getDartSdkCommand, "dart.getDartSdkCommand", !!config.workspaceGetDartSdkCommand);

		const dartSdkSearchPaths = [
			// TODO: These could move into processFuchsiaWorkspace and be set on the config?
			fuchsiaRoot && path.join(fuchsiaRoot, "topaz/tools/prebuilt-dart-sdk", `${dartPlatformName}-x64`),
			fuchsiaRoot && path.join(fuchsiaRoot, "third_party/dart/tools/sdks/dart-sdk"),
			fuchsiaRoot && path.join(fuchsiaRoot, "third_party/dart/tools/sdks", dartPlatformName, "dart-sdk"),
			fuchsiaRoot && path.join(fuchsiaRoot, "dart/tools/sdks", dartPlatformName, "dart-sdk"),
			firstFlutterProject && flutterSdkPath && path.join(flutterSdkPath, "bin/cache/dart-sdk"),
			config.sdkPath,
			dartSdkPathFromCommand?.path,
		].concat(paths)
			// The above array only has the Flutter SDK	in the search path if we KNOW it's a flutter
			// project, however this doesn't cover the activating-to-run-flutter.createProject so
			// we need to always look in the flutter SDK, but only AFTER the users PATH so that
			// we don't prioritise it over any real Dart versions.
			.concat([flutterSdkPath && path.join(flutterSdkPath, "bin/cache/dart-sdk")])
			.concat([workspaceConfig.defaultDartSdk])
			.filter(notUndefined);

		// Since we just blocked on a lot of sync FS, yield.
		await resolvedPromise;

		const dartSdkResult = this.findDartSdk(dartSdkSearchPaths);

		if (!hasAnyFlutterProject && !fuchsiaRoot && !firstFlutterProject && !workspaceConfig.forceFlutterWorkspace) {
			void this.warnIfBadConfigSdk(config.sdkPath, dartSdkResult, "dart.sdkPath", !!config.workspaceSdkPath);
		}

		let dartSdkPath = dartSdkResult.sdkPath;

		// Since we just blocked on a lot of sync FS, yield.
		await resolvedPromise;

		// If we still don't have a Dart SDK, but we do have a Flutter SDK and we did not already try to initialize, then
		// try again here. This could happen if we were not in a Flutter project (so didn't try to initialize before) but
		// still need a Dart SDK (for example, we were activated by running Flutter: New Project in an empty workspace.. we
		// wouldn't trigger the code above).
		if (!hasAttemptedFlutterInitialization && flutterSdkPath && !dartSdkPath) {
			await initializeFlutterSdk(this.logger, path.join(flutterSdkPath, flutterPath));
			dartSdkPath = this.findDartSdk([path.join(flutterSdkPath, "bin/cache/dart-sdk")]).sdkPath;
		}

		// It's possible we've opened a folder without a pubspec/etc., so before assuming this is a non-Dart project, check
		// for any Dart files in the top few folders.
		if (!hasAnyFlutterProject && !hasAnyStandardDartProject) {
			// Only look in the root and known folders to avoid a potentially slow full workspace search.
			const hasAnyDartFile = !!(await workspace.findFiles("{*.dart,lib/*.dart,bin/*.dart,tool/*.dart,test/*.dart}", undefined, 1)).length;
			hasAnyStandardDartProject = hasAnyDartFile;
		}

		// Sometimes the extension is activated when there's not a Dart/Flutter project open because the
		// events are not fine-grain enough (for example `activationEvent:onDebugDynamicConfigurations`), so
		// if this seems to be the case, turn off a few things that are likely not relevant for the user.
		if (!hasAnyFlutterProject && !hasAnyStandardDartProject) {
			const wc = workspaceConfig as WritableWorkspaceConfig;
			wc.disableAnalytics = true;
			wc.disableStartupPrompts = true;
			wc.disableSdkUpdateChecks = true;
		}

		const isDartFromFlutter = (!!dartSdkResult.originalPath && isDartSdkFromFlutter(dartSdkResult.originalPath)) || (!!dartSdkPath && isDartSdkFromFlutter(dartSdkPath));
		const dartVersion = getSdkVersion(this.logger, { sdkRoot: dartSdkPath });
		let flutterVersion = workspaceConfig?.flutterVersion ?? getSdkVersion(this.logger, { sdkRoot: flutterSdkPath });
		// Sometimes the Flutter 'version' file is missing (see https://github.com/flutter/flutter/issues/142521)
		// but this is almost always on main/master, so in this case treat us as a max version that has everything enabled
		// instead of nothing.
		if (!flutterVersion && flutterSdkPath && !fs.existsSync(path.join(flutterSdkPath, "version")))
			flutterVersion = MISSING_VERSION_FILE_VERSION;

		const relevantSdkVersion = hasAnyFlutterProject ? flutterVersion : dartVersion;
		const isPreReleaseSdk = !!relevantSdkVersion?.includes("-");

		return new WorkspaceContext(
			{
				dart: dartSdkPath,
				dartSdkIsFromFlutter: isDartFromFlutter,
				dartVersion,
				flutter: flutterSdkPath,
				flutterVersion,
				isPreReleaseSdk,
			},
			workspaceConfig,
			hasAnyFlutterProject,
			hasAnyWebProject,
			hasAnyStandardDartProject,
			!!fuchsiaRoot && hasAnyStandardDartProject,
		);
	}

	private async runCustomGetSDKCommand(command: GetSDKCommandConfig, sdkConfigName: "dart.getDartSdkCommand" | "dart.getFlutterSdkCommand", isWorkspaceSetting: boolean): Promise<GetSDKCommandResult> {
		const baseWorkDir = this.getWorkingDirectoryForGetSdkCommand();
		// No workspace open, nothing to do
		if (!baseWorkDir) return { path: undefined };

		const cmdWorkDir = command.cwd ?? ".";
		const cmdWorkDirAbs = path.isAbsolute(cmdWorkDir) ? cmdWorkDir : path.join(baseWorkDir, cmdWorkDir);
		try {
			const commandResult = await runToolProcess(this.logger, cmdWorkDirAbs, command.executable, command.args ?? [], command.env);
			if (commandResult.exitCode !== 0) {
				throw new Error(`Exited with non-zero code (${commandResult.exitCode})`);
			}
			const sdkPath = commandResult.stdout.trim();

			if (!sdkPath) {
				throw new Error("No output from command");
			}

			// Check if the path exists
			if (!fs.existsSync(sdkPath)) {
				throw new Error(`Path does not exist: ${sdkPath}`);
			}

			return { path: sdkPath };
		} catch (e) {
			void this.warnIfBadSDKCommandOutput(e, cmdWorkDirAbs, sdkConfigName, isWorkspaceSetting);
			return { error: `${e}` };
		}
	}

	/**
	 * Obtains a sane default as a working directory for the get SDK command.
	 * When using a multiroot workspace setup, return the directory of the workspace file
	 * Otherwise, return the path of the workspace directory.
	 * If there is no workspace directory, return undefined
	 */
	private getWorkingDirectoryForGetSdkCommand(): string | undefined {
		const workspaceFile = workspace.workspaceFile;
		const workspaceFolders = workspace.workspaceFolders;

		if (workspaceFile) {
			// Use the workspace file's directory in a multi-root setup
			return path.dirname(fsPath(workspaceFile));
		} else if (workspaceFolders && workspaceFolders.length > 0) {
			// Fallback to the first workspace folder
			return fsPath(workspaceFolders[0].uri);
		}

		// No workspace open
		return undefined;
	}

	private async warnIfBadConfigSdk(configSdkPath: string | undefined, foundSdk: SdkSearchResults, sdkConfigName: "dart.sdkPath" | "dart.flutterSdkPath", isWorkspaceSetting: boolean): Promise<void> {
		const foundSdkPath = foundSdk?.originalPath;
		if (!configSdkPath || !foundSdkPath) return;

		const normalizedConfigSdkPath = path.normalize(path.normalize(configSdkPath).toLowerCase() + path.sep);
		const normalizedFoundSdkPath = path.normalize(path.normalize(foundSdkPath).toLowerCase() + path.sep);

		if (normalizedConfigSdkPath !== normalizedFoundSdkPath) {
			const action = await window.showWarningMessage(`The SDK configured in ${sdkConfigName} is not a valid SDK folder: ${configSdkPath}`, openSettingsAction);
			if (openSettingsAction === action) {
				await this.openSettingsFile(sdkConfigName, isWorkspaceSetting);
			}
		}
	}

	private async warnIfBadSDKCommandOutput(error: any, workDir: string, sdkConfigName: "dart.getDartSdkCommand" | "dart.getFlutterSdkCommand", isWorkspaceSetting: boolean) {
		const action = await window.showWarningMessage(`Failed to obtain the SDK from the command: ${error}. Working directory: ${workDir}.`, openSettingsAction);
		if (openSettingsAction === action) {
			await this.openSettingsFile(sdkConfigName, isWorkspaceSetting);
		}
	}

	private async openSettingsFile(sdkConfigName: string, isWorkspaceSetting: boolean) {
		await commands.executeCommand(
			isWorkspaceSetting ? "workbench.action.openWorkspaceSettingsFile" : "workbench.action.openSettingsJson",
			{
				revealSetting: { key: sdkConfigName },
			}
		);
	}

	private findDartSdk(folders: string[]): SdkSearchResults {
		return this.searchPaths(folders, executableNames.dart, (p) => this.containsFile(p, dartVMPath) && this.containsFile(p, analyzerSnapshotPath));
	}

	private findFlutterSdk(folders: string[]): SdkSearchResults {
		return this.searchPaths(
			folders,
			executableNames.flutter,
			// Also check for some additional files so we won't detect `/usr/bin/flutter` as a Flutter SDK at `/usr`.
			(p) => this.containsFile(p, flutterPath) && (
				this.containsFile(p, "analysis_options.yaml")
				|| this.containsFile(p, "bin/flutter.bat") // Exists on non-Windows clones of Git and is an obvious sign of the SDK.
				|| this.containsFile(p, "bin/internal/engine.version")
			),
		);
	}

	private containsFile(folder: string, filePath: string): boolean {
		const fullPath = path.join(folder, filePath);
		return existsAndIsFileSync(fullPath);
	}

	public searchPaths(paths: string[], executableFilename: string, postFilter?: (s: string) => boolean): SdkSearchResults {
		this.logger.info(`Searching for ${executableFilename}`);

		const rawSdkPaths =
			paths
				.filter((p) => p)
				.map(resolvePaths)
				.filter(notUndefined);

		// Any that don't end with bin, add it on (as an extra path) since some of our
		// paths may come from places that don't already include it (for ex. the
		// user config.sdkPath).
		const isBinFolder = (f: string) => ["bin", "sbin"].includes(path.basename(f));
		let sdkPaths = flatMap(
			rawSdkPaths,
			(p): SdkSearchResult[] => isBinFolder(p)
				? [{ originalPath: p, sdkPath: p }]
				: [{ originalPath: p, sdkPath: p }, { originalPath: p, sdkPath: path.join(p, "bin") }],
		);

		// TODO: Make the list unique, but preserve the order of the first occurrences. We currently
		// have uniq() and unique(), so also consolidate them.

		this.logger.info(`    Looking for ${executableFilename} in:`);
		for (const p of sdkPaths)
			this.logger.info(`        ${this.sdkDisplayString(p)}`);

		// Restrict only to the paths that have the executable.
		sdkPaths = sdkPaths.filter((p) => fs.existsSync(path.join(p.sdkPath, executableFilename)));

		this.logger.info(`    Found at:`);
		for (const p of sdkPaths)
			this.logger.info(`        ${this.sdkDisplayString(p)}`);

		// Keep track if we find something that looks like a package manager init script. These are
		// symlinks like `flutter` that resolve to other binaries (like `snap` or `hermit`) and may need
		// to be executed if we don't find a real SDK.
		let sdkInitScript: string | undefined;

		// Convert all the paths to their resolved locations.
		sdkPaths = sdkPaths.map((sdkPath): SdkSearchResult => {
			// In order to handle symlinks on the binary (not folder), we need to add the executableName before calling realpath.
			const fullPath = path.join(sdkPath.sdkPath, executableFilename);
			const realExecutableLocation = safeRealpathSync(fullPath);

			if (realExecutableLocation.toLowerCase() !== fullPath.toLowerCase())
				this.logger.info(`Following symlink: ${fullPath} -> ${realExecutableLocation}`);

			// If the symlink resolves to a package manager binary, it's not a real SDK
			// and we should return as-is rather than walk up two levels, as we
			// may want to use the presence of this to trigger initialisation.
			const targetBaseName = path.basename(realExecutableLocation);
			if (targetBaseName !== executableFilename) {
				this.logger.info(`Target ${targetBaseName} is not ${executableFilename}, assuming ${fullPath} is a package manager init script`);
				sdkInitScript = fullPath;
				return { originalPath: sdkPath.originalPath, sdkPath: fullPath };
			}

			// Then we need to take the executable name and /bin back off
			return { originalPath: sdkPath.originalPath, sdkPath: path.dirname(path.dirname(realExecutableLocation)) };
		});

		// Now apply any post-filters.
		this.logger.info("    Candidate paths to be post-filtered:");
		for (const p of sdkPaths)
			this.logger.info(`        ${this.sdkDisplayString(p)}`);
		if (!postFilter)
			postFilter = ((_: string) => true);
		const sdkPath = sdkPaths.find((pathInfo) => postFilter(pathInfo.sdkPath));

		if (sdkPath)
			this.logger.info(`    Found at ${this.sdkDisplayString(sdkPath)}`);

		this.logger.info(`    Returning SDK path ${sdkPath?.sdkPath} for ${executableFilename}`);

		return {
			candidatePaths: sdkPaths.map((p) => p.sdkPath),
			sdkInitScript,
			...sdkPath,
		};
	}

	private sdkDisplayString(sdk: SdkSearchResult) {
		return `${sdk.originalPath}${sdk.sdkPath !== sdk.originalPath ? ` -> ${sdk.sdkPath}` : ""}`;
	}
}

async function findFuchsiaRoot(logger: Logger, folder: string): Promise<string | undefined> {
	return findRootContaining(folder, ".jiri_root", "DIRECTORY");
}

async function findBazelWorkspaceRoot(logger: Logger, folder: string): Promise<string | undefined> {
	return findRootContaining(folder, "WORKSPACE", "FILE");
}

async function findGitRoot(logger: Logger, folder: string): Promise<string | undefined> {
	return findRootContaining(folder, ".git", "ANY");
}

async function findDartSdkRoot(logger: Logger, folder: string): Promise<string | undefined> {
	const gitRoot = await findGitRoot(logger, folder);
	if (gitRoot && fs.existsSync(path.join(gitRoot, "README.dart-sdk")) && fs.existsSync(path.join(gitRoot, "DEPS")))
		return gitRoot;
	else
		return undefined;
}

function findRootContaining(folder: string, childName: string, expect: "FILE" | "DIRECTORY" | "ANY"): string | undefined {
	if (folder) {
		// Walk up the directories from the workspace root, and see if there
		// exists a directory which has `childName` file/directory as a child.
		let child = folder;
		while (child) {
			try {
				const fullPath = path.join(child, childName);
				if (expect === "ANY" || (expect === "FILE" ? existsAndIsFileSync(fullPath) : existsAndIsDirectorySync(fullPath)))
					return child;
			} catch { }

			const parentDir = path.dirname(child);
			if (child === parentDir)
				break;

			child = parentDir;
		}
	}

	return undefined;
}

enum GitOperationResult { success, error, cancelled };
