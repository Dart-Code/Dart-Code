import * as path from "path";
import * as vs from "vscode";
import { addedToPathPrompt, closeAction, copySdkPathToClipboardAction, failedToAddToPathPrompt, isWin, noSdkAvailablePrompt, openInstructionsAction, sdkAlreadyOnPathPrompt } from "../../shared/constants";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { envUtils } from "../../shared/vscode/utils";
import { WorkspaceContext } from "../../shared/workspace";
import { AddSdkToPathResult, Analytics } from "../analytics";
import { runToolProcess } from "../utils/processes";


export class AddSdkToPathCommands implements IAmDisposable {
	private disposables: IAmDisposable[] = [];

	constructor(private readonly logger: Logger, private readonly context: vs.ExtensionContext, wsContext: WorkspaceContext, private readonly analytics: Analytics) {
		this.disposables.push(vs.commands.registerCommand("dart.addSdkToPath", async () => {
			if (wsContext.sdks.dartSdkIsFromFlutter) {
				return vs.commands.executeCommand("flutter.addSdkToPath");
			}
			await this.addToPath(wsContext.sdks.dart);
		}));
		this.disposables.push(vs.commands.registerCommand("flutter.addSdkToPath", async () => {
			await this.addToPath(wsContext.sdks.flutter);
		}));
	}

	private async addToPath(sdkPath: string | undefined): Promise<void> {
		if (!sdkPath) {
			void vs.window.showErrorMessage(noSdkAvailablePrompt);
			return;
		}

		sdkPath = path.join(sdkPath, "bin");

		let result = AddSdkToPathResult.failed;
		try {
			result = isWin
				? await this.addToPathWindows(sdkPath)
				: AddSdkToPathResult.unavailableOnPlatform;
			if (result === AddSdkToPathResult.alreadyExisted || (result === AddSdkToPathResult.failed && process.env.PATH?.includes(sdkPath))) {
				void vs.window.showInformationMessage(sdkAlreadyOnPathPrompt);
			} else if (result === AddSdkToPathResult.succeeded) {
				void vs.window.showInformationMessage(addedToPathPrompt);
			} else {
				while (true) {
					const action = await vs.window.showWarningMessage(failedToAddToPathPrompt, openInstructionsAction, copySdkPathToClipboardAction, closeAction);
					if (action === openInstructionsAction) {
						await envUtils.openInBrowser("https://docs.flutter.dev/get-started/install/macos#update-your-path");
					} else if (action === copySdkPathToClipboardAction) {
						await vs.env.clipboard.writeText(sdkPath);
					} else {
						break;
					}
				}

			}
		} finally {
			this.analytics.logAddSdkToPath(result);
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
					scriptPath,
					// If we don't re-quote this, spaces break, even though runToolProcess is doing it?
					`"${sdkPath}"`,
				],
				undefined,
			);
			return result.exitCode === 1
				? AddSdkToPathResult.alreadyExisted
				: result.exitCode
					? AddSdkToPathResult.failed
					: AddSdkToPathResult.succeeded;
		} catch (e) {
			this.logger.error(e);
			return AddSdkToPathResult.failed;
		}
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}


