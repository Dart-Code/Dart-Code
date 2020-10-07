import { ProgressLocation, window } from "vscode";
import { initializingFlutterMessage, noAction, yesAction } from "../../shared/constants";
import { LogCategory } from "../../shared/enums";
import { Logger } from "../../shared/interfaces";
import { logProcess } from "../../shared/logging";
import { safeToolSpawn } from "../utils/processes";

export async function initializeFlutterSdk(logger: Logger, flutterScript: string, promptText?: string): Promise<void> {
	const selectedItem = promptText ? await window.showInformationMessage(promptText, yesAction, noAction) : yesAction;
	if (selectedItem === yesAction) {
		logger.info(`Flutter is not initialized, running 'flutter config --machine'...`);
		await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: initializingFlutterMessage,
			},
			async (progress, cancellationToken) => {
				const proc = safeToolSpawn(undefined, flutterScript, ["config", "--machine"]);
				cancellationToken.onCancellationRequested((e) => {
					logger.info(`User canceled!`);
					proc.kill();
				});
				// Log this to general as it's startup stuff that can't be captured with
				// Capture Logs so log it to the main log file.
				logProcess(logger, LogCategory.General, proc);
				return new Promise((resolve, reject) => proc.on("exit", (code) => {
					if (code) {
						logger.error(`Failed to initialize Flutter: Process exited with code ${code}.`);
						window.showErrorMessage(`Failed to initialize Flutter: Process exited with code ${code}.`);
						reject();
					} else
						resolve();
				}));
			},
		);
		logger.info(`Flutter initialized!`);
	}
}
