import * as vs from "vscode";
import { SUPPORTS_DEBUG_VALUE_FORMAT } from "../../shared/constants";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { config } from "../config";

export class DartDebugAdapterHexViewFactory implements vs.DebugAdapterTrackerFactory, IAmDisposable {
	protected readonly disposables: IAmDisposable[] = [];
	public readonly hexFormatters = new Set<DartDebugAdapterHexView>();

	public supportsFormatting = false;

	constructor(private readonly logger: Logger) {
		this.disposables.push(vs.workspace.onDidChangeConfiguration(this.handleConfigChange, this));
		this.disposables.push(vs.commands.registerCommand("_dart.showDebuggerNumbersAsHex", () => this.setFormatHex(true)));
		this.disposables.push(vs.commands.registerCommand("_dart.showDebuggerNumbersAsDecimal", () => this.setFormatHex(false)));
	}

	createDebugAdapterTracker(session: vs.DebugSession): vs.DebugAdapterTracker {
		const hexFormatter = new DartDebugAdapterHexView(this, this.logger, session);
		this.hexFormatters.add(hexFormatter);
		return hexFormatter;
	}

	private async handleConfigChange(conf: vs.ConfigurationChangeEvent) {
		if (conf.affectsConfiguration("dart.showDebuggerNumbersAsHex")) {
			if (this.supportsFormatting) {
				await this.invalidateAll();
			}
		}
	}

	private async setFormatHex(enabled: boolean) {
		await config.setShowDebuggerNumbersAsHex(enabled ? true : undefined);
		await this.invalidateAll();
	}

	private async invalidateAll() {
		await Promise.all([...this.hexFormatters].map((formatter) => formatter.invalidate()));
	}

	public dispose(): any {
		this.hexFormatters.clear();
		disposeAll(this.disposables);
	}
}

class DartDebugAdapterHexView implements vs.DebugAdapterTracker {
	constructor(private readonly factory: DartDebugAdapterHexViewFactory, private readonly logger: Logger, private readonly session: vs.DebugSession) { }

	public async invalidate() {
		try {
			await this.session.customRequest("_invalidateAreas", { areas: ["variables"] });
		} catch (e) {
			this.logger.error(e);
		}
	}

	onExit(code: number | undefined, signal: string | undefined): void {
		this.factory.hexFormatters.delete(this);
	}

	onDidSendMessage(message: any): void {
		if (!this.factory.supportsFormatting && message?.command === "initialize" && message?.body?.supportsValueFormattingOptions) {
			this.factory.supportsFormatting = true;
			vs.commands.executeCommand("setContext", SUPPORTS_DEBUG_VALUE_FORMAT, true);
		}
	}

	onWillReceiveMessage(message: any): void {
		if (this.factory.supportsFormatting && (message.command === "evaluate" || message.command === "variables")) {
			message.arguments ??= {};
			message.arguments.format ??= {};
			// Don't override if we happen to be a future version of VS Code that supports this.
			if (message.arguments.format.hex === undefined) {
				message.arguments.format.hex = config.showDebuggerNumbersAsHex;
			}
		}
	}
}
