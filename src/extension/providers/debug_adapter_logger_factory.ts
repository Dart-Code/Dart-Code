import { DebugAdapterTracker, DebugAdapterTrackerFactory, DebugSession } from "vscode";
import { LogCategory } from "../../shared/enums";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { captureLogs, CategoryLogger, EmittingLogger } from "../../shared/logging";
import { config } from "../config";
import { insertSessionName } from "../utils";
import { getLogHeader } from "../utils/log";

export class DartDebugAdapterLoggerFactory implements DebugAdapterTrackerFactory {
	constructor(private readonly logger: EmittingLogger) { }

	createDebugAdapterTracker(session: DebugSession): DebugAdapterTracker {
		return new DartDebugAdapterLogger(this.logger, session);
	}
}

class DartDebugAdapterLogger implements DebugAdapterTracker {
	private logger: Logger;
	private logFileDisposable: IAmDisposable | undefined;

	constructor(private readonly emittingLogger: EmittingLogger, private readonly session: DebugSession) {
		this.logger = new CategoryLogger(emittingLogger, LogCategory.DAP);
	}

	public onWillStartSession(): void {
		const dapLogFile = insertSessionName(this.session.configuration, config.dapLogFile);
		if (dapLogFile) {
			this.logFileDisposable = captureLogs(this.emittingLogger, dapLogFile, getLogHeader(), config.maxLogLineLength, [LogCategory.DAP]);
		}
		this.logger.info(`Starting debug session ${this.session.id}`);
	}

	public onWillReceiveMessage(message: any): void {
		this.logger.info(`==> ${JSON.stringify(message)}`);
	}

	public onDidSendMessage(message: any): void {
		this.logger.info(`<== ${JSON.stringify(message)}`);
	}

	public onWillStopSession() {
		this.logger.info(`Stopping debug session ${this.session.id}`);
	}

	public onError(error: Error): void {
		// We log this as info, as this isn't the place to handle errors and it seems to fire
		// whenever a debug session stops because the process stream goes away.
		this.logger.info(`Debug session ${this.session.id} errored: ${JSON.stringify(error)}`);
	}

	public onExit(code: number | undefined, signal: string | undefined): void {
		this.logger.info(`Debug session ${this.session.id} exit: code: ${code}, signal: ${signal}`);
		void this.logFileDisposable?.dispose();
		this.logFileDisposable = undefined;
	}
}
