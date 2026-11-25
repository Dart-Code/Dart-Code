import * as path from "path";
import { CancellationToken, CancellationTokenSource, window } from "vscode";
import { fiveSecondsInMs, flutterDartPath, flutterPath, initializingFlutterMessage, showLogAction } from "../../shared/constants";
import { LogCategory } from "../../shared/enums";
import { Logger } from "../../shared/interfaces";
import { logProcess, nullLogger } from "../../shared/logging";
import { BufferedLogger } from "../../shared/utils";
import { existsAndIsFileSync, getSdkVersion } from "../../shared/utils/fs";
import { withProgressIfSlow } from "../../shared/vscode/progress";
import * as channels from "../commands/channels";
import { ringLog } from "../extension";
import { openLogContents } from "../utils";
import { safeToolSpawn } from "../utils/processes";

export type FlutterInitializationTarget =
	| { flutterSdkPath: string }
	| { initScript: string };

function hasFlutterVersion(flutterSdkPath: string): boolean {
	return !!getSdkVersion(nullLogger, { sdkRoot: flutterSdkPath, isFlutter: true });
}

/**
 * Ensures the Flutter SDK is fully set up (has an up-to-date Dart SDK and version metadata).
 *
 * For standard Flutter SDKs that include `bin/dart` / `bin/dart.bat` and already have a valid Flutter
 * version file (`bin/cache/flutter.version.json` or `version`), runs `dart --version` first to avoid
 * loading the `flutter_tools` snapshot on every startup. If `dart --version` triggers a cache update
 * that deletes the version file (or no valid version file exists upfront), falls back to
 * `flutter --suppress-analytics --help` so `flutter.version.json` is generated before reading SDK capabilities.
 *
 * If we don't always initialize Flutter first, we might start spawning tools from a Dart SDK that
 * Flutter then starts to update/replace, causing a crash.
 */
export async function ensureFlutterInitialized(logger: Logger, target: FlutterInitializationTarget): Promise<void> {
	const cancellationTokenSource = new CancellationTokenSource();
	try {
		await withProgressIfSlow(
			initializeFlutter(logger, target, cancellationTokenSource.token),
			cancellationTokenSource,
			initializingFlutterMessage,
			{ showAfterMs: fiveSecondsInMs },
		);
		logger.info(`Flutter initialized!`);
	} catch (e) {
		logger.warn(`Flutter initialization failed, proceeding without! ${String(e)}`);
	} finally {
		cancellationTokenSource.dispose();
	}
}

async function initializeFlutter(logger: Logger, target: FlutterInitializationTarget, cancellationToken: CancellationToken): Promise<void> {
	if ("initScript" in target) {
		await runFlutterInitCommand(logger, target.initScript, ["--suppress-analytics", "--help"], cancellationToken);
		return;
	}

	const dartScript = path.join(target.flutterSdkPath, flutterDartPath);
	const flutterScript = path.join(target.flutterSdkPath, flutterPath);
	if (existsAndIsFileSync(dartScript) && hasFlutterVersion(target.flutterSdkPath)) {
		await runFlutterInitCommand(logger, dartScript, ["--version"], cancellationToken);
		if (hasFlutterVersion(target.flutterSdkPath))
			return;
		if (!cancellationToken.isCancellationRequested)
			logger.info("Flutter version file is missing after running 'dart --version'; running 'flutter --help' to regenerate it");
	}

	await runFlutterInitCommand(logger, flutterScript, ["--suppress-analytics", "--help"], cancellationToken);
}

/**
 * Runs the Flutter initialization command and returns a promise that resolves if there are no errors
 * and rejects (and shows the user an error) if there are errors.
 */
function runFlutterInitCommand(logger: Logger, script: string, args: string[], cancellationToken: CancellationToken): Promise<void> {
	if (cancellationToken.isCancellationRequested)
		return Promise.reject(new Error(`Flutter initialization was cancelled.`));

	logger.info(`Running '${script} ${args.join(" ")}' to ensure the Flutter SDK is initialized`);
	const proc = safeToolSpawn(undefined, script, args);

	// Show the output in an output channel so if it gets stuck the user can see it.
	const channel = channels.getOutputChannel(`flutter initialization`);
	channels.runProcessInOutputChannel(proc, channel);

	const cancellationSubscription = cancellationToken.onCancellationRequested(() => {
		logger.info(`User canceled!`);
		proc.kill();
	});
	// Log to a buffer so we can write it only if the process fails.
	const outputLog = new BufferedLogger();
	logProcess(outputLog, LogCategory.General, proc);
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		const fail = (message: string) => {
			if (settled)
				return;
			settled = true;
			cancellationSubscription.dispose();
			outputLog.flushTo(logger);
			channel.show();
			const ringLogContents = ringLog.toString();
			logger.error(message);
			void window.showErrorMessage(message, showLogAction).then((chosenAction) => {
				if (chosenAction === showLogAction)
					void openLogContents(undefined, ringLogContents);
			});
			reject(new Error(message));
		};

		proc.on("error", (err) => {
			const message = cancellationToken.isCancellationRequested
				? `Flutter initialization was cancelled.`
				: `Failed to initialize Flutter: ${String(err)}.`;
			fail(message);
		});

		proc.on("exit", (code, signal) => {
			if (settled)
				return;
			if (code !== 0 || cancellationToken.isCancellationRequested) {
				const message = cancellationToken.isCancellationRequested
					? `Flutter initialization was cancelled.`
					: signal
						? `Failed to initialize Flutter: Process terminated by signal ${signal}.`
						: `Failed to initialize Flutter: Process exited with code ${code}.`;
				fail(message);
			} else {
				settled = true;
				cancellationSubscription.dispose();
				resolve();
			}
		});
	});
}
