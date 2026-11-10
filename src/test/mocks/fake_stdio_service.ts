import { SpawnedProcess } from "../../shared/interfaces";
import { StdIOService } from "../../shared/services/stdio_service";
import { logger } from "../helpers";

export class FakeProcessStdIOService<T> extends StdIOService<T> {
	public readonly unhandledMessages: string[] = [];
	public readonly notifications: T[] = [];
	public readonly sentMessages: string[] = [];
	public notifyRequestAfterExitCount = 0;

	constructor(treatCarriageReturnsAsNewlines = false) {
		super(logger, undefined, undefined, undefined, treatCarriageReturnsAsNewlines, undefined);
	}

	protected shouldHandleMessage(message: string): boolean {
		return message.startsWith("{") && message.trim().endsWith("}");
	}

	protected processUnhandledMessage(message: string): void {
		this.unhandledMessages.push(message);
	}

	protected handleNotification(notification: T): void {
		this.notifications.push(notification);
	}

	protected override notifyRequestAfterExit(): void {
		this.notifyRequestAfterExitCount++;
	}

	protected createProcess() {
		// Don't really spawn a process.
	}

	public attachFakeProcess(proc: SpawnedProcess) {
		this.process = proc;
		this.registerProcessListeners(proc);
		proc.on("error", (error) => this.handleError(error));
	}

	public callCreateProcess(binPath: string) {
		super.createProcess(undefined, binPath, [], {});
	}

	public callSendRequest<TReq, TResp>(method: string, params?: TReq): Promise<TResp> {
		return this.sendRequest(method, params);
	}

	public callSendMessage(json: string) {
		this.sendMessage(json);
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
