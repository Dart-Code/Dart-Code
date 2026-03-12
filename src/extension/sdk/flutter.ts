import { CancellationToken, CancellationTokenSource, window } from "vscode";
import { fiveSecondsInMs, initializingFlutterMessage, showLogAction } from "../../shared/constants";
import { LogCategory } from "../../shared/enums";
import { Logger } from "../../shared/interfaces";
import { logProcess } from "../../shared/logging";
import { BufferedLogger } from "../../shared/utils";
import { withProgressIfSlow } from "../../shared/vscode/progress";
import * as channels from "../commands/channels";
import { ringLog } from "../extension";
import { openLogContents } from "../utils";
import { safeToolSpawn } from "../utils/processes";

/**
 * Runs `flutter --help` to ensure the Flutter SDK is fully set up (has a Dart SDK, etc.).
 *
 * If the version has changed or the Dart SDK is missing, this will trigger the download, which
 * will ensure the SDK is set up prior to us trying to spawn other tools like the Dart analysis server.
 *
 * If we don't always do this, we might start spawning tools from a Dart SDK that Flutter then starts to
 * update/replace, causing a crash.
 */
export async function ensureFlutterInitialized(logger: Logger, flutterScript: string): Promise<void> {
	logger.info("Running 'flutter --help' to ensure the Flutter SDK is initialized");
	try {
		const cancellationTokenSource = new CancellationTokenSource();
		await withProgressIfSlow(
			runFlutterHelp(logger, flutterScript, cancellationTokenSource.token),
			cancellationTokenSource,
			initializingFlutterMessage,
			{ showAfterMs: fiveSecondsInMs },
		);
		logger.info(`Flutter initialized!`);
	} catch (e) {
		logger.warn(`Flutter initialization failed, proceeding without! ${e}`);
	}
}

/**
 * Run `flutter --help` and return a promise that resolves if there are no errors and rejects (and shows the user
 * an error) if there are errors.
 */
function runFlutterHelp(logger: Logger, flutterScript: string, cancellationToken: CancellationToken): Promise<void> {
	const proc = safeToolSpawn(undefined, flutterScript, ["--suppress-analytics", "--help"]);

	// Show the output in an output channel so if it gets stuck the user can see it.
	const channel = channels.getOutputChannel(`flutter initialization`);
	channels.runProcessInOutputChannel(proc, channel);

	cancellationToken.onCancellationRequested(() => {
		logger.info(`User canceled!`);
		proc.kill();
	});
	// Log to a buffer so we can write it only if the process fails.
	const outputLog = new BufferedLogger();
	logProcess(outputLog, LogCategory.General, proc);
	return new Promise<void>((resolve, reject) => proc.on("exit", (code) => {
		if (code || cancellationToken.isCancellationRequested) {
			outputLog.flushTo(logger);
			channel.show();
			const ringLogContents = ringLog.toString();
			const message = cancellationToken.isCancellationRequested
				? `Flutter initialization was cancelled.`
				: `Failed to initialize Flutter: Process exited with code ${code}.`;
			logger.error(message);
			void window.showErrorMessage(message, showLogAction).then((chosenAction) => {
				if (chosenAction === showLogAction)
					void openLogContents(undefined, ringLogContents);
			});
			reject();
		} else {
			resolve();
		}
	}));
}
