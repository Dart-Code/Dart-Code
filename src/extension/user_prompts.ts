import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { DART_CREATE_PROJECT_TRIGGER_FILE, FLUTTER_CREATE_PROJECT_TRIGGER_FILE, flutterExtensionIdentifier, installFlutterExtensionPromptKey, isWin, noAction, recommendedSettingsUrl, showRecommendedSettingsAction, useRecommendedSettingsPromptKey, userPromptContextPrefix, yesAction } from "../shared/constants";
import { LogCategory } from "../shared/enums";
import { WebClient } from "../shared/fetch";
import { Analytics, DartProjectTemplate, FlutterCreateCommandArgs, FlutterCreateTriggerData, Logger } from "../shared/interfaces";
import { fsPath } from "../shared/utils/fs";
import { checkHasFlutterExtension, extensionVersion, getExtensionVersionForReleaseNotes, hasFlutterExtension, isDevExtension } from "../shared/vscode/extension_utils";
import { showFlutterSurveyNotificationIfAppropriate } from "../shared/vscode/user_prompts";
import { envUtils, getDartWorkspaceFolders } from "../shared/vscode/utils";
import { Context } from "../shared/vscode/workspace";
import { WorkspaceContext } from "../shared/workspace";
import { markProjectCreationEnded, markProjectCreationStarted } from "./commands/sdk";
import { promptToReloadExtension } from "./utils";

export async function showUserPrompts(logger: Logger, context: Context, webClient: WebClient, analytics: Analytics, workspaceContext: WorkspaceContext): Promise<void> {
	if (workspaceContext.config.disableStartupPrompts)
		return;

	function shouldSuppress(key: string): boolean {
		const stateKey = `${userPromptContextPrefix}${key}`;
		return context.get(stateKey) === true;
	}

	/// Shows a prompt and stores the return value. Prompt should return `true` to mark
	/// this extension as seen-forever and it won't be shown again. Returning anything
	/// else will allow the prompt to appear again next time.
	function showPrompt(key: string, prompt: () => Thenable<boolean>): void {
		const stateKey = `${userPromptContextPrefix}${key}`;
		prompt().then((res) => context.update(stateKey, res), error);
	}

	if (workspaceContext.hasAnyFlutterProjects && !hasFlutterExtension && !shouldSuppress(installFlutterExtensionPromptKey)) {
		// It's possible that we got here when the user installed the Flutter extension, because it causes Dart to install
		// first and activate. So, before showing this prompt we'll wait 30 seconds and then check if we still don't
		// have the Flutter extension, and then show the prompt.
		await new Promise((resolve) => setTimeout(resolve, 20000));
		if (!checkHasFlutterExtension())
			return showPrompt(installFlutterExtensionPromptKey, promptToInstallFlutterExtension);
	}

	// Check the user hasn't installed Flutter in a forbidden location that will cause issues.
	if (workspaceContext.hasAnyFlutterProjects && workspaceContext.sdks.flutter) {
		if (isWin) {
			const forbiddenLocations = [
				process.env.COMMONPROGRAMFILES,
				process.env["COMMONPROGRAMFILES(x86)"],
				process.env.CommonProgramW6432,
				process.env.PROGRAMFILES,
				process.env.ProgramW6432,
				process.env["PROGRAMFILES(X86)"],
			];

			const installedForbiddenLocation = forbiddenLocations.find((fl) => fl && workspaceContext.sdks.flutter?.toLowerCase().startsWith(fl.toLowerCase()));

			if (installedForbiddenLocation) {
				logger.error(`Flutter is installed in protected folder: ${installedForbiddenLocation}`);
				void vs.window.showErrorMessage("The Flutter SDK is installed in a protected folder and may not function correctly. Please move the SDK to a location that is user-writable without Administration permissions and restart.");
			}
		}
	}

	const extensionVersionForReleaseNotes = getExtensionVersionForReleaseNotes();
	const lastSeenVersionNotification = context.lastSeenVersion;
	if (!lastSeenVersionNotification) {
		// If we've not got a stored version, this is the first install, so just
		// stash the current version and don't show anything.
		context.lastSeenVersion = extensionVersionForReleaseNotes;
	} else if (!isDevExtension && lastSeenVersionNotification !== extensionVersionForReleaseNotes) {
		const versionLink = extensionVersionForReleaseNotes.split(".").slice(0, 2).join(".").replace(".", "-");
		void promptToShowReleaseNotes(extensionVersion, versionLink).then(() =>
			context.lastSeenVersion = extensionVersionForReleaseNotes,
		);
		return;
	}

	if (workspaceContext.hasAnyFlutterProjects) {
		if (await showFlutterSurveyNotificationIfAppropriate(context, webClient, analytics, envUtils.openInBrowser, Date.now(), logger))
			return; // Bail if we showed it, so we won't show any other notifications.
	}

	if (!shouldSuppress(useRecommendedSettingsPromptKey) && !hasAnyExistingDartSettings()) {
		showPrompt(useRecommendedSettingsPromptKey, promptToUseRecommendedSettings);
		return;
	}

	// (though, there are no other notifications right now...)
}

function hasAnyExistingDartSettings(): boolean {
	const topLevelConfig = vs.workspace.getConfiguration("", null);
	for (const configKey of ["dart", "[dart]"]) {
		const dartConfig = topLevelConfig.inspect(configKey);
		if (dartConfig?.globalValue || dartConfig?.globalLanguageValue
			|| dartConfig?.workspaceValue || dartConfig?.workspaceLanguageValue
			|| dartConfig?.workspaceFolderValue || dartConfig?.workspaceFolderLanguageValue)
			return true;
	}
	return false;
}

async function promptToUseRecommendedSettings(): Promise<boolean> {
	const action = await vs.window.showInformationMessage(
		"Would you like to use recommended VS Code settings for Dart & Flutter?",
		yesAction,
		noAction,
		showRecommendedSettingsAction,
	);
	if (action === yesAction) {
		await vs.commands.executeCommand("dart.writeRecommendedSettings");
	} else if (action === showRecommendedSettingsAction) {
		await envUtils.openInBrowser(recommendedSettingsUrl);
	}
	return true;
}

async function promptToInstallFlutterExtension(): Promise<boolean> {
	const installExtension = "Install Flutter Extension";
	const res = await vs.window.showInformationMessage(
		"The Flutter extension is required to work with Flutter projects.",
		installExtension,
	);
	if (res === installExtension) {
		await installExtensionWithProgress("Installing Flutter extension", flutterExtensionIdentifier);
		void promptToReloadExtension();
	}

	return false;
}

export async function installExtensionWithProgress(message: string, extensionIdentifier: string): Promise<void> {
	await vs.window.withProgress({ location: vs.ProgressLocation.Notification },
		(progress) => {
			progress.report({ message });

			return new Promise<void>((resolve) => {
				vs.extensions.onDidChange((e) => resolve());
				void vs.commands.executeCommand("workbench.extensions.installExtension", extensionIdentifier);
			});
		},
	);
}

async function promptToShowReleaseNotes(versionDisplay: string, versionLink: string): Promise<boolean> {
	const res = await vs.window.showInformationMessage(
		`Dart Code has been updated to v${versionDisplay}`,
		`Show Release Notes`,
	);
	if (res) {
		await envUtils.openInBrowser(`https://dartcode.org/releases/v${versionLink}/`);
	}
	return true; // Always mark this as done; we don't want to prompt the user multiple times.
}

function error(err: any) {
	void vs.window.showErrorMessage(`${err.message ?? err}`);
}

export async function handleNewProjects(logger: Logger, context: Context): Promise<void> {
	await Promise.all(getDartWorkspaceFolders().map(async (wf) => {
		try {
			await handleDartCreateTrigger(logger, wf, DART_CREATE_PROJECT_TRIGGER_FILE);
			await handleFlutterCreateTrigger(wf);
		} catch (e) {
			logger.error("Failed to create project");
			logger.error(e);
			void vs.window.showErrorMessage("Failed to create project");
		}
	}));
}

async function handleDartCreateTrigger(logger: Logger, wf: vs.WorkspaceFolder, triggerFilename: string): Promise<void> {
	const triggerFile = path.join(fsPath(wf.uri), triggerFilename);
	if (!fs.existsSync(triggerFile))
		return;

	const templateJson = fs.readFileSync(triggerFile).toString().trim();
	let template: DartProjectTemplate;
	try {
		template = JSON.parse(templateJson);
	} catch (e) {
		logger.error("Failed to get project templates");
		logger.error(e);
		void vs.window.showErrorMessage("Failed to get project templates to create project");
		return;
	}
	fs.unlinkSync(triggerFile);
	logger.info(`Creating Dart project for ${fsPath(wf.uri)}`, LogCategory.CommandProcesses);
	try {
		markProjectCreationStarted();

		const success = await createDartProject(fsPath(wf.uri), template.name);
		if (success) {
			logger.info(`Fetching packages for newly-created project`, LogCategory.CommandProcesses);
			await vs.commands.executeCommand("dart.getPackages", wf.uri);
			handleDartWelcome(wf, template);
			logger.info(`Finished creating new project!`, LogCategory.CommandProcesses);
		} else {
			logger.info(`Failed to create new project`, LogCategory.CommandProcesses);
		}
	} finally {
		markProjectCreationEnded();
	}
}

async function handleFlutterCreateTrigger(wf: vs.WorkspaceFolder): Promise<void> {
	const flutterTriggerFile = path.join(fsPath(wf.uri), FLUTTER_CREATE_PROJECT_TRIGGER_FILE);
	if (!fs.existsSync(flutterTriggerFile))
		return;

	const jsonString: string | undefined = fs.readFileSync(flutterTriggerFile).toString().trim();
	const json = jsonString ? JSON.parse(jsonString) as FlutterCreateTriggerData : undefined;

	fs.unlinkSync(flutterTriggerFile);

	try {
		markProjectCreationStarted();
		const success = await createFlutterProject(fsPath(wf.uri), json);
		if (success)
			handleFlutterWelcome(wf, json);
	} finally {
		markProjectCreationEnded();
	}
}

async function createDartProject(projectPath: string, templateName: string): Promise<boolean> {
	const code = await vs.commands.executeCommand<number>("_dart.create", projectPath, templateName);
	return code === 0;
}

async function createFlutterProject(projectPath: string, triggerData: FlutterCreateTriggerData | undefined): Promise<boolean> {
	const projectName = triggerData?.sample ? "sample" : undefined;
	const args = { projectPath, projectName, triggerData } as FlutterCreateCommandArgs;
	const code = await vs.commands.executeCommand<number>("_flutter.create", args);
	return code === 0;
}

function handleFlutterWelcome(workspaceFolder: vs.WorkspaceFolder, triggerData: FlutterCreateTriggerData | undefined) {
	const entryFile = path.join(fsPath(workspaceFolder.uri), "lib/main.dart");
	openFile(entryFile);
	if (triggerData?.sample)
		void vs.window.showInformationMessage(`${triggerData.sample} sample ready! Press F5 to start running.`);
	else
		void vs.window.showInformationMessage("Your Flutter project is ready! Press F5 to start running.");
}

function handleDartWelcome(workspaceFolder: vs.WorkspaceFolder, template: DartProjectTemplate) {
	const workspacePath = fsPath(workspaceFolder.uri);
	const projectName = path.basename(workspacePath);
	const entryFile = path.join(workspacePath, template.entrypoint.replace("__projectName__", projectName));
	openFile(entryFile);
	void vs.window.showInformationMessage(`${template.label} project ready!`);
}

/// Opens a file, but does it in a setTimeout to work around VS Code reveal bug
/// https://github.com/Microsoft/vscode/issues/71588#event-2252962973
function openFile(entryFile: string) {
	if (!fs.existsSync(entryFile))
		return;

	// TODO: Remove this setTimeout when it's no longer required.
	setTimeout(() => {
		void vs.commands.executeCommand("vscode.open", vs.Uri.file(entryFile));
	}, 100);
}
