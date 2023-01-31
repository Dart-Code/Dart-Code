import { DebugAdapterTracker, DebugAdapterTrackerFactory, DebugSession } from "vscode";
import { LogCategory } from "../../shared/enums";
import { Logger } from "../../shared/interfaces";
import { CategoryLogger } from "../../shared/logging";

export class DartDebugAdapterLoggerFactory implements DebugAdapterTrackerFactory {
	private readonly logger: Logger;
	constructor(logger: Logger) {
		this.logger = new CategoryLogger(logger, LogCategory.DAP);
	}

	createDebugAdapterTracker(session: DebugSession): DebugAdapterTracker {
		return new DartDebugAdapterLogger(this.logger, session);
	}
}

class DartDebugAdapterLogger implements DebugAdapterTracker {
	constructor(private readonly logger: Logger, private readonly session: DebugSession) { }

	public onWillStartSession(): void {
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
	}
}
