import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { vsCodeVersion } from "../../shared/capabilities/vscode";
import { defaultLaunchJson } from "../../shared/constants";
import { DartWorkspaceContext, FlutterCreateCommandArgs, FlutterCreateTriggerData, FlutterProjectTemplate, Logger } from "../../shared/interfaces";
import { sortBy } from "../../shared/utils/array";
import { stripMarkdown } from "../../shared/utils/dartdocs";
import { fsPath, mkDirRecursive, nextAvailableFilename } from "../../shared/utils/fs";
import { writeFlutterSdkSettingIntoProject, writeFlutterTriggerFile } from "../../shared/utils/projects";
import { FlutterDeviceManager } from "../../shared/vscode/device_manager";
import { createFlutterSampleInTempFolder } from "../../shared/vscode/flutter_samples";
import { FlutterSampleSnippet } from "../../shared/vscode/interfaces";
import { Context } from "../../shared/vscode/workspace";
import { config } from "../config";
import { getFlutterSnippets } from "../sdk/flutter_docs_snippets";
import { SdkUtils } from "../sdk/utils";
import * as util from "../utils";
import { PickableSetting, showInputBoxWithSettings, showSimpleSettingsEditor } from "../utils/vscode/input";
import { getFolderToRunCommandIn } from "../utils/vscode/projects";
import { BaseSdkCommands, commandState, packageNameRegex } from "./sdk";

export class FlutterCommands extends BaseSdkCommands {
	private flutterScreenshotPath?: string;

	constructor(logger: Logger, context: Context, workspace: DartWorkspaceContext, private readonly sdkUtils: SdkUtils, dartCapabilities: DartCapabilities, private readonly flutterCapabilities: FlutterCapabilities, private readonly deviceManager: FlutterDeviceManager | undefined) {
		super(logger, context, workspace, dartCapabilities);

		this.disposables.push(vs.commands.registerCommand("flutter.clean", this.flutterClean, this));
		this.disposables.push(vs.commands.registerCommand("_flutter.screenshot.touchBar", (args: any) => vs.commands.executeCommand("flutter.screenshot", args)));
		this.disposables.push(vs.commands.registerCommand("flutter.screenshot", this.flutterScreenshot, this));
		this.disposables.push(vs.commands.registerCommand("flutter.doctor", this.flutterDoctor, this));
		this.disposables.push(vs.commands.registerCommand("flutter.upgrade", this.flutterUpgrade, this));
		this.disposables.push(vs.commands.registerCommand("flutter.createProject", this.createFlutterProject, this));
		this.disposables.push(vs.commands.registerCommand("_dart.flutter.createSampleProject", this.createFlutterSampleProject, this));
		this.disposables.push(vs.commands.registerCommand("_flutter.create", this.flutterCreate, this));
		this.disposables.push(vs.commands.registerCommand("_flutter.clean", this.flutterClean, this));
	}


	private async flutterClean(selection: vs.Uri | undefined): Promise<number | undefined> {
		if (!selection) {
			const path = await getFolderToRunCommandIn(this.logger, `Select the folder to run "flutter clean" in`, selection, true);
			if (!path)
				return;
			selection = vs.Uri.file(path);
		}

		return this.runFlutter(["clean"], selection);
	}

	private async flutterScreenshot() {
		let shouldNotify = false;

		// If there is no path for this session, or it differs from config, use the one from config.
		if (!this.flutterScreenshotPath ||
			(config.flutterScreenshotPath && this.flutterScreenshotPath !== config.flutterScreenshotPath)) {
			this.flutterScreenshotPath = config.flutterScreenshotPath;
			shouldNotify = true;
		}

		// If path is still empty, bring up the folder selector.
		if (!this.flutterScreenshotPath) {
			const selectedFolder =
				await vs.window.showOpenDialog({ canSelectFolders: true, openLabel: "Set screenshots folder" });
			if (selectedFolder && selectedFolder.length > 0) {
				// Set variable to selected path. This allows prompting the user only once.
				this.flutterScreenshotPath = selectedFolder[0].path;
				shouldNotify = true;
			} else {
				// Do nothing if the user cancelled the folder selection.
				return;
			}
		}

		// Ensure folder exists.
		mkDirRecursive(this.flutterScreenshotPath);

		const debugSession = vs.debug.activeDebugSession;
		if (!debugSession) {
			vs.window.showErrorMessage("You must have an active Flutter debug session to take screenshots");
			return;
		}
		if (debugSession.type !== "dart") {
			vs.window.showErrorMessage("The active debug session is not a Flutter app");
			return;
		}

		const projectFolder = debugSession.configuration.cwd;
		const deviceId = debugSession.configuration.deviceId ?? this.deviceManager?.currentDevice?.id;
		const outputFilename = nextAvailableFilename(this.flutterScreenshotPath, "flutter_", ".png");
		const args = ["screenshot"];
		if (deviceId) {
			args.push("-d");
			args.push(deviceId);
		}
		args.push("-o");
		args.push(path.join(this.flutterScreenshotPath, outputFilename));
		await this.runFlutterInFolder(projectFolder, args, "screenshot");

		if (shouldNotify) {
			const res = await vs.window.showInformationMessage(`Screenshots will be saved to ${this.flutterScreenshotPath}`, "Show Folder");
			if (res)
				await vs.commands.executeCommand("revealFileInOS", vs.Uri.file(this.flutterScreenshotPath));
		}
	}

	public flutterDoctor() {
		if (!this.workspace.sdks.flutter) {
			this.sdkUtils.showFlutterActivationFailure("flutter.doctor");
			return;
		}
		const tempDir = path.join(os.tmpdir(), "dart-code-cmd-run");
		if (!fs.existsSync(tempDir))
			fs.mkdirSync(tempDir);
		return this.runFlutterInFolder(tempDir, ["doctor", "-v"], "flutter", true, this.workspace.config?.flutterDoctorScript);
	}

	private async flutterUpgrade() {
		if (!this.workspace.sdks.flutter) {
			this.sdkUtils.showFlutterActivationFailure("flutter.upgrade");
			return;
		}
		const tempDir = path.join(os.tmpdir(), "dart-code-cmd-run");
		if (!fs.existsSync(tempDir))
			fs.mkdirSync(tempDir);
		// Don't prompt to reload when the version changes, as we automatically reload here.
		commandState.promptToReloadOnVersionChanges = false;
		await this.runFlutterInFolder(tempDir, ["upgrade"], "flutter", true);
		await util.promptToReloadExtension();
	}

	private async flutterCreate({ projectName, projectPath, triggerData, platform }: FlutterCreateCommandArgs) {
		if (!projectPath) {
			projectPath = await getFolderToRunCommandIn(this.logger, `Select the folder to run "flutter create" in`, undefined, true);
			if (!projectPath)
				return;
		}

		const args = ["create"];
		if (config.flutterCreateOffline) {
			args.push("--offline");
		}
		if (platform) {
			args.push("--platforms");
			args.push(platform);
		}
		if (projectName) {
			args.push("--project-name");
			args.push(projectName);
		}
		if (config.flutterCreateOrganization) {
			args.push("--org");
			args.push(config.flutterCreateOrganization);
		}
		if (config.flutterCreateIOSLanguage && config.flutterCreateIOSLanguage !== "swift") {
			args.push("--ios-language");
			args.push(config.flutterCreateIOSLanguage);
		}
		if (config.flutterCreateAndroidLanguage && config.flutterCreateAndroidLanguage !== "kotlin") {
			args.push("--android-language");
			args.push(config.flutterCreateAndroidLanguage);
		}
		if (triggerData?.sample) {
			args.push("--sample");
			args.push(triggerData.sample);
			args.push("--overwrite");
		}
		if (triggerData?.template) {
			args.push("--template");
			args.push(triggerData.template);
			args.push("--overwrite");
		}
		args.push(".");

		const exitCode = await this.runFlutterInFolder(projectPath, args, projectName);

		if (!vsCodeVersion.supportsDebugWithoutLaunchJson) {
			this.writeDefaultLaunchJson(projectPath);
		}

		return exitCode;
	}

	private writeDefaultLaunchJson(projectPath: string) {
		const launchJsonFolder = path.join(projectPath, vsCodeVersion.editorConfigFolder);
		const launchJsonFile = path.join(launchJsonFolder, "launch.json");
		if (!fs.existsSync(launchJsonFile)) {
			mkDirRecursive(launchJsonFolder);
			fs.writeFileSync(launchJsonFile, defaultLaunchJson);
		}
	}

	private getFlutterTemplates(): Array<vs.QuickPickItem & { template: FlutterProjectTemplate }> {
		const templates = [
			{
				detail: "Generate a Flutter application.",
				label: "Application",
				template: { id: "app" },
			},
			{
				detail: "Generate a project to add a Flutter module to an existing Android or iOS application.",
				label: "Module",
				template: { id: "module" },
			},
			{
				detail: "Generate a shareable Flutter project containing modular Dart code.",
				label: "Package",
				template: { id: "package" },
			},
			{
				detail: "Generate a shareable Flutter project containing an API in Dart code with a platform-specific implementation for Android, for iOS code, or for both.",
				label: "Plugin",
				template: { id: "plugin" },
			},
		];

		if (this.flutterCapabilities.supportsCreateSkeleton) {
			templates.push({
				detail: "Generate a List View / Detail View Flutter application that follows community best practices.",
				label: "Skeleton",
				template: { id: "skeleton" },
			});
		}

		return templates;
	}

	private async createFlutterProject(): Promise<vs.Uri | undefined> {
		if (!this.sdks || !this.sdks.flutter) {
			this.sdkUtils.showFlutterActivationFailure("flutter.createProject");
			return;
		}

		const pickItems = this.getFlutterTemplates();

		const selectedTemplate = await vs.window.showQuickPick(
			pickItems,
			{
				matchOnDescription: true,
				placeHolder: "Which Flutter template?",
			},
		);

		if (!selectedTemplate)
			return;

		return this.createFlutterProjectForTemplate(selectedTemplate.template.id);
	}

	private async createFlutterProjectForTemplate(template: string): Promise<vs.Uri | undefined> {
		if (!this.sdks || !this.sdks.flutter) {
			this.sdkUtils.showFlutterActivationFailure("flutter.createProject");
			return;
		}

		// If already in a workspace, set the default folder to something nearby.
		const folders = await vs.window.showOpenDialog({
			canSelectFolders: true,
			defaultUri: this.context.lastUsedNewProjectPath ? vs.Uri.file(this.context.lastUsedNewProjectPath) : undefined,
			openLabel: "Select a folder to create the project in",
		});
		if (!folders || folders.length !== 1)
			return;
		const folderPath = fsPath(folders[0]);
		this.context.lastUsedNewProjectPath = folderPath;

		const defaultName = nextAvailableFilename(folderPath, "flutter_application_");
		const name = await this.promptForNameWithSettings(defaultName, folderPath);
		if (!name)
			return;

		const projectFolderUri = vs.Uri.file(path.join(folderPath, name));
		const projectFolderPath = fsPath(projectFolderUri);

		if (fs.existsSync(projectFolderPath)) {
			vs.window.showErrorMessage(`A folder named ${name} already exists in ${folderPath}`);
			return;
		}

		// Create the empty folder so we can open it.
		fs.mkdirSync(projectFolderPath);

		const triggerData: FlutterCreateTriggerData | undefined = template ? { template } : undefined;
		writeFlutterTriggerFile(projectFolderPath, triggerData);

		// If we're using a custom SDK, we need to apply it to the new project too.
		if (config.workspaceFlutterSdkPath)
			writeFlutterSdkSettingIntoProject(config.workspaceFlutterSdkPath, projectFolderPath);

		vs.commands.executeCommand("vscode.openFolder", projectFolderUri);

		return projectFolderUri;
	}

	private async promptForNameWithSettings(defaultName: string, folderPath: string): Promise<string | undefined> {
		while (true) {
			const response = await showInputBoxWithSettings(
				this.context,
				{
					placeholder: defaultName,
					prompt: "Enter a name for your new project",
					title: "Project Name",
					validation: (s) => this.validateFlutterProjectName(s, folderPath),
					value: defaultName,
				},
			);

			if (response === "SETTINGS") {
				await showSimpleSettingsEditor(
					"Settings for new Flutter projects",
					"Select a setting to change (or 'Escape' to cancel)",
					flutterCreateSettings,
				);
				continue;
			} else if (response) {
				return response.value;
			} else {
				return undefined;
			}
		}
	}

	private async createFlutterSampleProject(): Promise<vs.Uri | undefined> {
		if (!this.sdks || !this.sdks.flutter) {
			this.sdkUtils.showFlutterActivationFailure("_dart.flutter.createSampleProject");
			return;
		}

		// Fetch the JSON for the available samples.
		let snippets: FlutterSampleSnippet[];
		try {
			snippets = await getFlutterSnippets(this.logger, this.sdks, this.flutterCapabilities);
		} catch {
			vs.window.showErrorMessage("Unable to retrieve Flutter documentation snippets");
			return;
		}

		const sortedSnippets = sortBy(snippets, (s) => s.element);

		const selectedSnippet = await vs.window.showQuickPick(
			sortedSnippets.map((s) => ({
				description: `${s.package}/${s.library}`,
				detail: stripMarkdown(s.description),
				label: s.element,
				snippet: s,
			})),
			{
				matchOnDescription: true,
				placeHolder: "Which Flutter sample?",
			},
		);
		if (!selectedSnippet)
			return;

		return createFlutterSampleInTempFolder(this.flutterCapabilities, selectedSnippet.snippet.id, config.workspaceFlutterSdkPath);
	}

	private validateFlutterProjectName(input: string, folderDir: string) {
		if (!packageNameRegex.test(input))
			return "Flutter project names should be all lowercase, with underscores to separate words";

		const bannedNames = ["flutter", "flutter_test", "test", "integration_test"];
		if (bannedNames.includes(input))
			return `You may not use ${input} as the name for a flutter project`;

		if (fs.existsSync(path.join(folderDir, input)))
			return `A project with this name already exists within the selected directory`;
	}
}

const flutterCreateSettings: PickableSetting[] = [
	{
		currentValue: config.flutterCreateOrganization || "com.example",
		description: config.flutterCreateOrganization || "com.example",
		detail: "The organization responsible for your new Flutter project, in reverse domain name notation. This string is used in Java package names and as prefix in the iOS bundle identifier.",
		label: "Organization",
		setValue: (newValue) => config.setFlutterCreateOrganization(newValue),
		settingKind: "STRING",
	},
	{
		currentValue: config.flutterCreateAndroidLanguage || "kotlin",
		description: config.flutterCreateAndroidLanguage || "kotlin",
		detail: "The language to use for Android-specific code, either Java (legacy) or Kotlin (recommended).",
		enumValues: ["kotlin", "java"],
		label: "Android Language",
		setValue: (newValue) => config.setFlutterCreateAndroidLanguage(newValue),
		settingKind: "ENUM",
	},
	{
		currentValue: config.flutterCreateIOSLanguage || "swift",
		description: config.flutterCreateIOSLanguage || "swift",
		detail: "The language to use for iOS-specific code, either ObjectiveC (legacy) or Swift (recommended).",
		enumValues: ["swift", "objc"],
		label: "iOS Language",
		setValue: (newValue) => config.setFlutterCreateIOSLanguage(newValue),
		settingKind: "ENUM",
	},
	{
		currentValue: config.flutterCreateOffline ? "enabled" : "not enabled",
		description: config.flutterCreateOffline ? "enabled" : "not enabled",
		detail: "When \"flutter pub get\" is run by the create command, this indicates whether to run it in offline mode or not. In offline mode, it will need to have all dependencies already available in the pub cache to succeed.",
		label: "Create Projects Offline",
		setValue: (newValue) => config.setFlutterCreateOffline(newValue),
		settingKind: "BOOL",
	},
];
