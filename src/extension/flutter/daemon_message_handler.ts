import { ExtensionContext, window } from "vscode";
import { DaemonLog, DaemonLogMessage, ShowMessage } from "../../shared/flutter/daemon_interfaces";
import { IFlutterDaemon, Logger } from "../../shared/interfaces";
import { getOutputChannel } from "../commands/channels";

export function setUpDaemonMessageHandler(logger: Logger, context: ExtensionContext, daemon: IFlutterDaemon) {
	function showShouldOutput(log: DaemonLog | DaemonLogMessage): boolean {
		const isError = "error" in log ? log.error : log.level === "error";
		if (!isError)
			return false;

		const message = "error" in log ? log.log : log.message;

		// The daemon reports lots of errors during normal operation, so we only
		// show the error for some specific known things.
		const knownErrorStrings = [
			"Android emulator stderr",
			"Address these issues and try again",
			// If we ever need to add to this list, consider updating Flutter to pass
			// some flag to separate errors that should be shown to users from those
			// that are normal (for example adb errors are printed normally during
			// a device connection).
		];
		return !!knownErrorStrings.find((s) => message.includes(s));
	}

	const channel = getOutputChannel("flutter daemon", true);
	context.subscriptions.push(daemon.registerForDaemonLog((l: DaemonLog) => {
		if (showShouldOutput(l))
			channel.show(true);
		const prefix = l.error ? "[ERR] " : "";
		channel.appendLine(`${prefix}${l.log}`);
	}));
	context.subscriptions.push(daemon.registerForDaemonLogMessage((l: DaemonLogMessage) => {
		if (showShouldOutput(l))
			channel.show(true);
		const prefix = l.level === "error"
			? "[ERR] "
			: l.level === "warning"
				? "[WARN]" : "";
		channel.appendLine(`${prefix}${l.message}`);
	}));
	context.subscriptions.push(daemon.registerForDaemonShowMessage((l: ShowMessage) => {
		const title = l.title.trim().endsWith(".") ? l.title.trim() : `${l.title.trim()}.`;
		const message = `${title} ${l.message}`.trim();
		switch (l.level) {
			case "info":
				void window.showInformationMessage(message);
				break;
			case "warning":
				void window.showWarningMessage(message);
				break;
			case "error":
				void window.showErrorMessage(message);
				break;
			default:
				logger.warn(`Unexpected daemon.showMessage type: ${l.level}`);
		}
	}));
}
