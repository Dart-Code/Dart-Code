import { ExtensionContext, window } from "vscode";
import { getChannel } from "../commands/channels";
import { logError } from "../utils";
import { FlutterDaemon } from "./flutter_daemon";
import { LogMessage, ShowMessage } from "./flutter_types";

export function setUpDaemonMessageHandler(context: ExtensionContext, daemon: FlutterDaemon) {
	context.subscriptions.push(daemon.registerForDaemonLogMessage((l: LogMessage) => {
		const channel = getChannel("Flutter Daemon");
		channel.show(true);
		channel.appendLine(`[${l.level}] ${l.message}`);
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
				logError({ message: `Unexpected daemon.showMessage type: ${l.level}` });
		}
	}));
}
