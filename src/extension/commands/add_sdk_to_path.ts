import * as path from "path";
import * as vs from "vscode";
import { SdkTypeString, addSdkToPathAction, addSdkToPathPrompt, addToPathInstructionsUrl, addedToPathPrompt, copySdkPathToClipboardAction, isChromeOS, isWin, noSdkAvailablePrompt, noThanksAction, openInstructionsAction, sdkAlreadyOnPathPrompt, unableToAddToPathPrompt } from "../../shared/constants";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { envUtils } from "../../shared/vscode/utils";
import { WorkspaceContext } from "../../shared/workspace";
import { AddSdkToPathResult, Analytics } from "../analytics";
import { runToolProcess } from "../utils/processes";

export class AddSdkToPath {
	constructor(private readonly logger: Logger, private readonly context: vs.ExtensionContext, private readonly analytics: Analytics) { }

	public async addToPath(sdkType: SdkTypeString, sdkPath: string | undefined): Promise<void> {
		if (!sdkPath) {
			void vs.window.showErrorMessage(noSdkAvailablePrompt);
			return;
		}

		sdkPath = path.join(sdkPath, "bin");

		let result = AddSdkToPathResult.failed;
		try {
			result = this.canAddPathAutomatically()
				? isWin
					? await this.addToPathWindows(sdkPath)
					// If we add more platforms here, we must also remove the isWin check in
					// tryFlutterCloneIfGitAvailable() so the prompt to add to PATH shows.
					: AddSdkToPathResult.unavailableOnPlatform
				: AddSdkToPathResult.unavailableOnPlatform;
			if (result === AddSdkToPathResult.alreadyExisted || (result === AddSdkToPathResult.failed && process.env.PATH?.includes(sdkPath))) {
				void vs.window.showInformationMessage(sdkAlreadyOnPathPrompt(sdkType));
			} else if (result === AddSdkToPathResult.succeeded) {
				void vs.window.showInformationMessage(addedToPathPrompt(sdkType));
			} else if (this.canShowInstructions()) {
				await this.showManualInstructions(sdkType, sdkPath, result === AddSdkToPathResult.failed);
			}
		} finally {
			this.analytics.logAddSdkToPath(result);
		}
	}

	public async promptToAddToPath(sdkType: SdkTypeString, sdkPath: string): Promise<void> {
		if (!this.canAddPathAutomatically() && !this.canShowInstructions())
			return;

		// Change isWin here if we support this on other platforms in AddSdkToPath.addToPath.
		if (this.canAddPathAutomatically()) {
			const action = await vs.window.showInformationMessage(addSdkToPathPrompt(sdkType), addSdkToPathAction, noThanksAction);
			if (action === addSdkToPathAction)
				await this.addToPath(sdkType, sdkPath);
		} else {
			await this.showManualInstructions(sdkType, sdkPath);
		}
	}

	private canAddPathAutomatically(): boolean {
		return isWin;
	}

	private canShowInstructions(): boolean {
		return !isChromeOS;
	}

	private async showManualInstructions(sdkType: SdkTypeString, sdkPath: string, didFailToAutomaticallyAdd = false): Promise<void> {
		if (!addToPathInstructionsUrl)
			return;

		while (true) {
			const action = didFailToAutomaticallyAdd
				? await vs.window.showWarningMessage(unableToAddToPathPrompt(sdkType), openInstructionsAction, copySdkPathToClipboardAction, noThanksAction)
				: await vs.window.showInformationMessage(addSdkToPathPrompt(sdkType), openInstructionsAction, copySdkPathToClipboardAction, noThanksAction);
			if (action === openInstructionsAction) {
				await envUtils.openInBrowser(addToPathInstructionsUrl);
			} else if (action === copySdkPathToClipboardAction) {
				await vs.env.clipboard.writeText(sdkPath);
			} else {
				break;
			}
		}
	}

	private async addToPathWindows(sdkPath: string): Promise<AddSdkToPathResult> {
		try {
			const scriptPath = this.context.asAbsolutePath("media/add_to_path.ps1");
			const result = await runToolProcess(
				this.logger,
				undefined,
				"powershell",
				[
					"-NoProfile",
					"-NonInteractive",
					"-WindowStyle", "Hidden",
					"-ExecutionPolicy", "Bypass",
					"-File", scriptPath,
					sdkPath,
				],
				undefined,
			);
			return result.exitCode === 12345
				? AddSdkToPathResult.alreadyExisted
				: result.exitCode
					? AddSdkToPathResult.failed
					: AddSdkToPathResult.succeeded;
		} catch (e) {
			this.logger.error(e);
			return AddSdkToPathResult.failed;
		}
	}
}

export class AddSdkToPathCommands extends AddSdkToPath implements IAmDisposable {
	private disposables: IAmDisposable[] = [];

	constructor(logger: Logger, context: vs.ExtensionContext, wsContext: WorkspaceContext, analytics: Analytics) {
		super(logger, context, analytics);
		this.disposables.push(vs.commands.registerCommand("dart.addSdkToPath", async () => {
			if (wsContext.sdks.dartSdkIsFromFlutter) {
				return vs.commands.executeCommand("flutter.addSdkToPath");
			}
			await this.addToPath("Dart", wsContext.sdks.dart);
		}));
		this.disposables.push(vs.commands.registerCommand("flutter.addSdkToPath", async () => {
			await this.addToPath("Flutter", wsContext.sdks.flutter);
		}));
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
