import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { DART_STAGEHAND_PROJECT_TRIGGER_FILE, flutterExtensionIdentifier, FLUTTER_CREATE_PROJECT_TRIGGER_FILE, FLUTTER_STAGEHAND_PROJECT_TRIGGER_FILE, installFlutterExtensionPromptKey, userPromptContextPrefix } from "../shared/constants";
import { LogCategory } from "../shared/enums";
import { Logger, StagehandTemplate } from "../shared/interfaces";
import { checkHasFlutterExtension, extensionVersion, hasFlutterExtension, isDevExtension } from "../shared/vscode/extension_utils";
import { showFlutterSurveyNotificationIfAppropriate } from "../shared/vscode/user_prompts";
import { fsPath, getDartWorkspaceFolders, openInBrowser } from "../shared/vscode/utils";
import { Context } from "../shared/vscode/workspace";
import { WorkspaceContext } from "../shared/workspace";
import { markProjectCreationEnded, markProjectCreationStarted } from "./commands/sdk";
import { reloadExtension } from "./utils";

export async function showUserPrompts(logger: Logger, context: Context, workspaceContext: WorkspaceContext): Promise<void> {
	handleNewProjects(logger, context);

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

	const lastSeenVersionNotification = context.lastSeenVersion;
	if (!lastSeenVersionNotification) {
		// If we've not got a stored version, this is the first install, so just
		// stash the current version and don't show anything.
		context.lastSeenVersion = extensionVersion;
	} else if (!isDevExtension && lastSeenVersionNotification !== extensionVersion) {
		const versionLink = extensionVersion.split(".").slice(0, 2).join(".").replace(".", "-");
		promptToShowReleaseNotes(extensionVersion, versionLink).then(() =>
			context.lastSeenVersion = extensionVersion,
		);
		return;
	}

	if (workspaceContext.hasAnyFlutterProjects) {
		if (showFlutterSurveyNotificationIfAppropriate(context, Date.now(), logger))
			return; // Bail if we showed it, so we won't show any other notifications.
	}

	// (though, there are no other notifications right now...)
}

async function promptToInstallFlutterExtension(): Promise<boolean> {
	const installExtension = "Install Flutter Extension";
	const res = await vs.window.showInformationMessage(
		"The Flutter extension is required to work with Flutter projects.",
		installExtension,
	);
	if (res === installExtension) {
		await vs.window.withProgress({ location: vs.ProgressLocation.Notification },
			(progress) => {
				progress.report({ message: "Installing Flutter extension" });

				return new Promise((resolve) => {
					vs.extensions.onDidChange((e) => resolve());
					vs.commands.executeCommand("workbench.extensions.installExtension", flutterExtensionIdentifier);
				});
			},
		);
		reloadExtension();
	}

	return false;
}

async function promptToShowReleaseNotes(versionDisplay: string, versionLink: string): Promise<boolean> {
	const res = await vs.window.showInformationMessage(
		`Dart Code has been updated to v${versionDisplay}`,
		`Show Release Notes`,
	);
	if (res) {
		openInBrowser(`https://dartcode.org/releases/v${versionLink}/`);
	}
	return true; // Always mark this as done; we don't want to prompt the user multiple times.
}

function error(err: any) {
	vs.window.showErrorMessage(err.message);
}

async function handleNewProjects(logger: Logger, context: Context): Promise<void> {
	// HACK: In order for tests to be able to intercept these commands we need to
	// ensure they don't start before the test is running, so insert a delay when
	// running tests.
	if (process.env.DART_CODE_IS_TEST_RUN)
		await new Promise((resolve) => setTimeout(resolve, 5000));
	getDartWorkspaceFolders().forEach((wf) => {
		handleStagehandTrigger(logger, wf, DART_STAGEHAND_PROJECT_TRIGGER_FILE);
		handleStagehandTrigger(logger, wf, FLUTTER_STAGEHAND_PROJECT_TRIGGER_FILE);
		handleFlutterCreateTrigger(wf);
	});
}

async function handleStagehandTrigger(logger: Logger, wf: vs.WorkspaceFolder, triggerFilename: string): Promise<void> {
	const triggerFile = path.join(fsPath(wf.uri), triggerFilename);
	if (fs.existsSync(triggerFile)) {
		const templateJson = fs.readFileSync(triggerFile).toString().trim();
		let template: StagehandTemplate;
		try {
			template = JSON.parse(templateJson);
		} catch (e) {
			vs.window.showErrorMessage("Failed to run Stagehand to create project");
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
}

async function handleFlutterCreateTrigger(wf: vs.WorkspaceFolder): Promise<void> {
	const flutterTriggerFile = path.join(fsPath(wf.uri), FLUTTER_CREATE_PROJECT_TRIGGER_FILE);
	if (fs.existsSync(flutterTriggerFile)) {
		let sampleID: string | undefined = fs.readFileSync(flutterTriggerFile).toString().trim();
		sampleID = sampleID ? sampleID : undefined;
		fs.unlinkSync(flutterTriggerFile);
		try {
			markProjectCreationStarted();
			const success = await createFlutterProject(fsPath(wf.uri), sampleID);
			if (success)
				handleFlutterWelcome(wf, sampleID);
		} finally {
			markProjectCreationEnded();
		}
	}
}

async function createDartProject(projectPath: string, templateName: string): Promise<boolean> {
	const code = await vs.commands.executeCommand("_dart.create", projectPath, templateName) as number;
	return code === 0;
}

async function createFlutterProject(projectPath: string, sampleID: string | undefined): Promise<boolean> {
	const projectName = sampleID ? "sample" : undefined;
	const code = await vs.commands.executeCommand("_flutter.create", projectPath, projectName, sampleID) as number;
	return code === 0;
}

function handleFlutterWelcome(workspaceFolder: vs.WorkspaceFolder, sampleID: string | undefined) {
	const entryFile = path.join(fsPath(workspaceFolder.uri), "lib/main.dart");
	openFile(entryFile);
	if (sampleID)
		vs.window.showInformationMessage(`${sampleID} sample ready! Connect a device and press F5 to run.`);
	else
		vs.window.showInformationMessage("Your Flutter project is ready! Connect a device and press F5 to start running.");
}

function handleDartWelcome(workspaceFolder: vs.WorkspaceFolder, template: StagehandTemplate) {
	const workspacePath = fsPath(workspaceFolder.uri);
	const projectName = path.basename(workspacePath);
	const entryFile = path.join(workspacePath, template.entrypoint.replace("__projectName__", projectName));
	openFile(entryFile);
	vs.window.showInformationMessage(`${template.label} project ready!`);
}

/// Opens a file, but does it in a setTimeout to work around VS Code reveal bug
/// https://github.com/Microsoft/vscode/issues/71588#event-2252962973
function openFile(entryFile: string) {
	if (!fs.existsSync(entryFile))
		return;

	// TODO: Remove this setTimeout when it's no longer required.
	setTimeout(() => {
		vs.commands.executeCommand("vscode.open", vs.Uri.file(entryFile));
	}, 100);
}
