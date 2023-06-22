import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { DART_CREATE_PROJECT_TRIGGER_FILE, dartVMPath } from "../../shared/constants";
import { DartProjectTemplate, DartWorkspaceContext, Logger } from "../../shared/interfaces";
import { sortBy } from "../../shared/utils/array";
import { fsPath, nextAvailableFilename } from "../../shared/utils/fs";
import { writeDartSdkSettingIntoProject } from "../../shared/utils/projects";
import { Context } from "../../shared/vscode/workspace";
import { Analytics, AnalyticsEvent } from "../analytics";
import { config } from "../config";
import { PubGlobal } from "../pub/global";
import { DartCreate } from "../sdk/dart/dart_create";
import { SdkUtils } from "../sdk/utils";
import { BaseSdkCommands, packageNameRegex } from "./sdk";

export class DartCommands extends BaseSdkCommands {
	constructor(logger: Logger, context: Context, workspace: DartWorkspaceContext, private readonly sdkUtils: SdkUtils, private readonly pubGlobal: PubGlobal, dartCapabilities: DartCapabilities, private readonly analytics: Analytics) {
		super(logger, context, workspace, dartCapabilities);

		this.disposables.push(vs.commands.registerCommand("dart.createProject", this.createDartProject, this));
		this.disposables.push(vs.commands.registerCommand("_dart.create", this.dartCreate, this));
	}

	private dartCreate(projectPath: string, templateName: string) {
		if (!this.dartCapabilities.supportsDartCreate) {
			void vs.window.showErrorMessage("Creating projects is only supported for Dart SDKs >= v2.10");
			return;
		}

		const binPath = path.join(this.sdks.dart, dartVMPath);
		const projectContainer = path.dirname(projectPath);
		const projectName = path.basename(projectPath);
		const args = ["create", "-t", templateName, projectName, "--force"];
		return this.runCommandInFolder(templateName, projectContainer, binPath, args, false);
	}


	private async createDartProject(): Promise<void> {
		const command = "dart.createProject";
		const triggerFilename = DART_CREATE_PROJECT_TRIGGER_FILE;
		const autoPickIfSingleItem = false;

		if (!this.sdks || !this.sdks.dart) {
			this.sdkUtils.showDartActivationFailure(command);
			return;
		}

		if (!this.dartCapabilities.supportsDartCreate) {
			void vs.window.showErrorMessage("Creating projects is only supported for Dart SDKs >= v2.10");
			return;
		}

		this.analytics.log(AnalyticsEvent.Command_DartNewProject);

		// Get the JSON for the available templates by calling 'dart create'.

		const creator = new DartCreate(this.logger, this.sdks);
		let templates: DartProjectTemplate[];
		try {
			templates = await creator.getTemplates();
		} catch (e) {
			void vs.window.showErrorMessage(`Unable to fetch project templates. ${e}`);
			return;
		}

		const sortedTemplates = sortBy(templates, (s) => s.label);
		const pickItems = sortedTemplates.map((t) => ({
			description: t.name,
			detail: t.description,
			label: t.label,
			template: t,
		}));

		// Get the user to pick a template (but pick for them if there's only one
		// and autoPickIfSingleItem).
		const selectedTemplate =
			autoPickIfSingleItem && pickItems.length === 1
				? pickItems[0]
				: await vs.window.showQuickPick(
					pickItems,
					{
						ignoreFocusOut: true,
						matchOnDescription: true,
						placeHolder: "Which Dart template?",
					},
				);

		if (!selectedTemplate)
			return;

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

		const projectKind = this.getProjectKind(selectedTemplate.template.name);
		const defaultName = nextAvailableFilename(folderPath, `dart_${projectKind}_`);
		const name = await vs.window.showInputBox({
			ignoreFocusOut: true,
			placeHolder: defaultName,
			prompt: "Enter a name for your new project",
			validateInput: (s) => this.validateDartProjectName(s, folderPath),
			value: defaultName,
		});
		if (!name)
			return;

		const projectFolderUri = vs.Uri.file(path.join(folderPath, name));
		const projectFolderPath = fsPath(projectFolderUri);

		if (fs.existsSync(projectFolderPath)) {
			void vs.window.showErrorMessage(`A folder named ${name} already exists in ${folderPath}`);
			return;
		}

		// Create the empty folder so we can open it.
		fs.mkdirSync(projectFolderPath);
		// Create a temp dart file to force extension to load when we open this folder.
		fs.writeFileSync(path.join(projectFolderPath, triggerFilename), JSON.stringify(selectedTemplate.template));
		// If we're using a custom SDK, we need to apply it to the new project too.
		if (config.workspaceSdkPath)
			writeDartSdkSettingIntoProject(config.workspaceSdkPath, projectFolderPath);

		void vs.commands.executeCommand("vscode.openFolder", projectFolderUri);
	}

	private validateDartProjectName(input: string, folderDir: string) {
		if (!packageNameRegex.test(input))
			return "Dart project names should be all lowercase, with underscores to separate words";

		const bannedNames = ["dart", "test", "this"];
		if (bannedNames.includes(input))
			return `You may not use ${input} as the name for a dart project`;

		if (fs.existsSync(path.join(folderDir, input)))
			return `A project with this name already exists within the selected directory`;
	}

	private getProjectKind(templateName: string) {
		if (templateName.includes("package"))
			return "package";
		if (templateName.includes("web"))
			return "web_application";

		return "application";
	}
}
