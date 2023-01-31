import * as vs from "vscode";
import { SUPPORTS_DEBUG_VALUE_FORMAT } from "../../shared/constants";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { config } from "../config";

export class DartDebugAdapterHexViewFactory implements vs.DebugAdapterTrackerFactory {
	constructor(private readonly logger: Logger) { }
	createDebugAdapterTracker(session: vs.DebugSession): vs.DebugAdapterTracker {
		return new DartDebugAdapterHexView(this.logger, session);
	}
}

class DartDebugAdapterHexView implements vs.DebugAdapterTracker {
	private supportsFormatting = false;

	protected disposables: IAmDisposable[] = [];

	constructor(private readonly logger: Logger, private readonly session: vs.DebugSession) {
		this.disposables.push(vs.workspace.onDidChangeConfiguration(this.handleConfigChange, this));
		this.disposables.push(vs.commands.registerCommand("_dart.showDebuggerNumbersAsHex", () => this.setFormatHex(true)));
		this.disposables.push(vs.commands.registerCommand("_dart.showDebuggerNumbersAsDecimal", () => this.setFormatHex(false)));
	}

	private async setFormatHex(enabled: boolean) {
		await config.setShowDebuggerNumbersAsHex(enabled ? true : undefined);
		await this.invalidate();
	}

	private async handleConfigChange(conf: vs.ConfigurationChangeEvent) {
		if (conf.affectsConfiguration("dart.showDebuggerNumbersAsHex")) {
			if (this.supportsFormatting) {
				await this.invalidate();
			}
		}
	}

	private async invalidate() {
		try {
			await this.session.customRequest("_invalidateAreas", { areas: ["variables"] });
		} catch (e) {
			this.logger.error(e);
		}
	}

	onExit(code: number | undefined, signal: string | undefined): void {
		disposeAll(this.disposables);
	}

	onDidSendMessage(message: any): void {
		if (!this.supportsFormatting && message?.command === "initialize" && message?.body?.supportsValueFormattingOptions) {
			this.supportsFormatting = true;
			vs.commands.executeCommand("setContext", SUPPORTS_DEBUG_VALUE_FORMAT, true);
		}
	}

	onWillReceiveMessage(message: any): void {
		if (this.supportsFormatting && (message.command === "evaluate" || message.command === "variables")) {
			message.arguments ??= {};
			message.arguments.format ??= {};
			// Don't override if we happen to be a future version of VS Code that supports this.
			if (message.arguments.format.hex === undefined) {
				message.arguments.format.hex = config.showDebuggerNumbersAsHex;
			}
		}
	}
}
