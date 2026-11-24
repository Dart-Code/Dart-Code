import { DebugProtocol } from "@vscode/debugprotocol";
import * as vs from "vscode";
import { SUPPORTS_DEBUG_VALUE_FORMAT } from "../../shared/constants.contexts";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { config } from "../config";

export class DartDebugAdapterHexViewFactory implements vs.DebugAdapterTrackerFactory, IAmDisposable {
	protected readonly disposables: IAmDisposable[] = [];
	public readonly hexFormatters = new Set<DartDebugAdapterHexView>();

	public supportsFormatting = false;

	constructor(private readonly logger: Logger) {
		this.disposables.push(vs.workspace.onDidChangeConfiguration(this.handleConfigChange.bind(this)));
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

	public dispose(): void {
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

	onExit(): void {
		this.factory.hexFormatters.delete(this);
	}

	onDidSendMessage(message: unknown): void {
		if (!this.factory.supportsFormatting && message && typeof message === "object" && "command" in message && message.command === "initialize") {
			const response = message as DebugProtocol.InitializeResponse;
			if (response.body?.supportsValueFormattingOptions) {
				this.factory.supportsFormatting = true;
				void vs.commands.executeCommand("setContext", SUPPORTS_DEBUG_VALUE_FORMAT, true);
			}
		}
	}

	onWillReceiveMessage(message: unknown): void {
		if (this.factory.supportsFormatting && message && typeof message === "object" && "command" in message && (message.command === "evaluate" || message.command === "variables")) {
			const request = message as DebugProtocol.EvaluateRequest | DebugProtocol.VariablesRequest;
			request.arguments ??= {} as DebugProtocol.EvaluateArguments & DebugProtocol.VariablesArguments;
			request.arguments.format ??= {};
			// Don't override if we happen to be a future version of VS Code that supports this.
			request.arguments.format.hex ??= config.showDebuggerNumbersAsHex;
		}
	}
}
