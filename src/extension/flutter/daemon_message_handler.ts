import { ExtensionContext, window } from "vscode";
import { Logger } from "../../shared/interfaces";
import { getChannel } from "../commands/channels";
import { FlutterDaemon } from "./flutter_daemon";
import { DaemonLog, ShowMessage } from "./flutter_types";

export function setUpDaemonMessageHandler(logger: Logger, context: ExtensionContext, daemon: FlutterDaemon) {
	context.subscriptions.push(daemon.registerForDaemonLog((l: DaemonLog) => {
		const channel = getChannel("Flutter Daemon");
		// Don't show, as we get errors from this just when disconnected devices!
		// channel.show(true);
		channel.appendLine(`${l.error ? "[ERR] " : ""}${l.log}`);
	}));
	context.subscriptions.push(daemon.registerForDaemonShowMessage((l: ShowMessage) => {
		const title = l.title.trim().endsWith(".") ? l.title.trim() : `${l.title.trim()}.`;
		const message = `${title} ${l.message}`.trim();
		switch (l.level) {
			case "info":
				window.showInformationMessage(message);
				break;
			case "warning":
				window.showWarningMessage(message);
				break;
			case "error":
				window.showErrorMessage(message);
				break;
			default:
				logger.warn(`Unexpected daemon.showMessage type: ${l.level}`);
		}
	}));
}
