import { ExtensionContext, window } from "vscode";
import { DaemonLog, ShowMessage } from "../../shared/flutter/daemon_interfaces";
import { IFlutterDaemon, Logger } from "../../shared/interfaces";
import { getOutputChannel } from "../commands/channels";

export function setUpDaemonMessageHandler(logger: Logger, context: ExtensionContext, daemon: IFlutterDaemon) {
	const channel = getOutputChannel("flutter daemon", true);
	context.subscriptions.push(daemon.registerForDaemonLog((l: DaemonLog) => {
		// Don't show, as we get errors from this just when disconnected devices!
		// channel.show(true);
		channel.appendLine(`${l.error ? "[ERR] " : ""}${l.log}`);
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
