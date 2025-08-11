import { StdIOService } from "../../shared/services/stdio_service";
import { logger } from "../helpers";

export class FakeProcessStdIOService<T> extends StdIOService<T> {
	public readonly unhandledMessages: string[] = [];
	public readonly notifications: T[] = [];
	public readonly sentMessages: string[] = [];

	constructor(treatCarriageReturnsAsNewlines = false) {
		super(logger, undefined, undefined, undefined, treatCarriageReturnsAsNewlines, undefined);
	}

	protected shouldHandleMessage(message: string): boolean {
		return message.startsWith("{") && message.trim().endsWith("}");
	}

	protected async processUnhandledMessage(message: string): Promise<void> {
		this.unhandledMessages.push(message);
	}

	protected async handleNotification(notification: T): Promise<void> {
		this.notifications.push(notification);
	}

	protected createProcess() {
		// Don't really spawn a process.
	}

	public sendStdOut(data: string | Buffer) {
		this.handleStdOut(data);
	}

	public sendStdErr(data: string | Buffer) {
		this.handleStdErr(data);
	}

	public sendExit(code: number | null, signal: NodeJS.Signals | null) {
		this.handleExit(code, signal);
	}

	public sendError(error: Error) {
		this.handleError(error);
	}
}
