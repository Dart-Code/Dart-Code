import * as fs from "fs";
import { IAmDisposable, IAmDisposableAsync, Logger, SpawnedProcess } from "../interfaces";
import { safeSpawn } from "../processes";
import { Request, UnknownResponse } from "../services/interfaces";
import { disposeAllAsync, PromiseCompleter, PromiseOr } from "../utils";

// Reminder: This class is used in the debug adapter as well as the main Code process!

export abstract class StdIOService<T> implements IAmDisposable {
	private readonly disposables: IAmDisposableAsync[] = [];
	public process?: SpawnedProcess;
	protected readonly additionalPidsToTerminate: number[] = [];
	private nextRequestID = 1;
	private readonly activeRequests: Record<string, [(result: unknown) => void | Promise<void>, (error: unknown) => void | Promise<void>, string] | "CANCELLED"> = {};
	private messageBuffers: Buffer[] = [];
	private openLogFile: string | undefined;
	private logStream?: fs.WriteStream;
	protected processExited = false;
	private processExitCompleter = new PromiseCompleter<ProcessExitCodes>();
	public processExit = this.processExitCompleter.promise;
	private description: string | undefined;
	protected isDisposed = false;

	constructor(
		public readonly logger: Logger,
		public readonly maxLogLineLength: number | undefined,
		public messagesWrappedInBrackets = false,
		public readonly treatHandlingErrorsAsUnhandledMessages = false,
		public readonly treatCarriageReturnsAsNewlines = false,
		private logFile?: string) {
	}

	protected createProcess(workingDirectory: string | undefined, binPath: string, args: string[], envOverrides: { envOverrides?: Record<string, string | undefined>, toolEnv?: Record<string, string | undefined> }) {
		if (this.isDisposed) {
			this.logTraffic(`Skipping spawning ${binPath} because service has already been disposed`);
			return;
		}

		this.logTraffic(`Spawning ${binPath} with args ${JSON.stringify(args)}`);
		this.description = binPath;
		if (workingDirectory)
			this.logTraffic(`..  in ${workingDirectory}`);
		if (envOverrides.envOverrides || envOverrides.toolEnv)
			this.logTraffic(`..  with ${JSON.stringify(envOverrides)}`);

		const env = Object.assign({}, envOverrides.toolEnv, envOverrides.envOverrides);
		try {
			this.process = safeSpawn(workingDirectory, binPath, args, env);
		} catch (e) {
			this.logger.error(`Failed to spawn process! ${String(e)}`);
			this.handleError(e);
			this.handleExit(null, null);
		}

		if (this.process) {
			this.logTraffic(`    PID: ${this.process.pid}`);

			this.registerProcessListeners(this.process);
			this.process.on("error", (error) => this.handleError(error));
		}
	}

	protected registerProcessListeners(proc: SpawnedProcess) {
		proc.stdout.on("data", (data: Buffer | string) => this.handleStdOut(data));
		proc.stderr.on("data", (data: Buffer | string) => this.handleStdErr(data));
		proc.stdin.on("error", (error) => this.logTraffic(`Process stdin errored! ${String(error)}`));
		proc.stdout.on("error", (error) => this.logTraffic(`Process stdout errored! ${String(error)}`));
		proc.stderr.on("error", (error) => this.logTraffic(`Process stderr errored! ${String(error)}`));
		proc.on("exit", (code, signal) => this.handleExit(code, signal));
	}

	/// Flutter may send only \r as a line terminator for improved terminal output
	/// but we should always treat this as a standard newline (eg. terminating a message)
	/// so all \r's can be replaced with \n immediately. Blank lines (from \n\n)
	/// are already handled gracefully.
	///
	/// https://github.com/flutter/flutter/pull/57590
	private normalizeNewlines(data: Buffer | string): Buffer {
		const normalised = this.treatCarriageReturnsAsNewlines
			? Buffer.from(data.toString().replace(/\r/g, "\n"))
			: data;
		return Buffer.from(normalised);
	}

	protected handleStdOut(data: Buffer | string) {
		data = this.normalizeNewlines(data);

		// Add this message to the buffer for processing.
		this.messageBuffers.push(data);

		// Kick off processing if we have a full message.
		if (data.indexOf("\n") >= 0)
			this.processMessageBuffer();
	}

	protected handleStdErr(data: Buffer | string) {
		this.logTraffic(`${data.toString()}`, true);
	}

	protected handleExit(code: number | null, signal: NodeJS.Signals | null) {
		const isError = !!code;
		this.logTraffic(`Process ${this.description} terminated! ${code}, ${signal}`, isError);
		this.processExited = true;
		this.processExitCompleter.resolve({ code, signal });
	}

	protected handleError(error: unknown) {
		this.logTraffic(`Process errored! ${String(error)}`);
	}

	protected buildRequest<TReq>(id: number, method: string, params?: TReq): { id: string, method: string, params?: TReq } {
		return {
			id: id.toString(),
			method,
			params,
		};
	}

	protected notifyRequestAfterExit() { }

	protected sendRequest<TReq, TResp>(method: string, params?: TReq): Promise<TResp> {
		// Generate an ID for this request so we can match up the response.
		const id = this.nextRequestID++;

		return new Promise<TResp>((resolve, reject) => {
			if (this.isDisposed) {
				reject(new Error(`Tried to call "${method}" after service was disposed`));
				return;
			}
			if (this.processExited || (this.process && (this.process.stdin.destroyed || this.process.stdin.writableEnded))) {
				this.notifyRequestAfterExit();
				reject(new Error(`Tried to call "${method}" but process has already exited with code ${this.process?.exitCode}`));
				return;
			}

			// Stash the callbacks so we can call them later.
			this.activeRequests[id.toString()] = [resolve as (result: unknown) => void, reject, method];

			const req = this.buildRequest(id, method, params);
			const json = this.messagesWrappedInBrackets
				? "[" + JSON.stringify(req) + "]\r\n"
				: JSON.stringify(req) + "\r\n";
			this.sendMessage(json);
		});
	}

	public cancelAllRequests() {
		// TODO(dantup): Consider/test rejecting all active requests?
		Object.keys(this.activeRequests).forEach((key) => this.activeRequests[key] = "CANCELLED");
	}

	protected sendMessage(json: string) {
		this.logTraffic(`==> ${json}`);
		if (this.isDisposed)
			this.logTraffic(`  (not sent: disposed)`);
		else if (!this.process)
			this.logTraffic(`  (not sent: no process)`);
		else if (this.processExited || this.process.stdin.destroyed || this.process.stdin.writableEnded)
			this.logTraffic(`  (not sent: stdin closed)`);
		else
			this.process.stdin.write(json);
	}

	protected processMessageBuffer() {
		let fullBuffer = Buffer.concat(this.messageBuffers);
		this.messageBuffers = [];

		// If the message doesn't end with \n then put the last part back into the buffer.
		const lastNewline = fullBuffer.lastIndexOf("\n");
		if (lastNewline !== fullBuffer.length - 1) {
			const incompleteMessage = fullBuffer.slice(lastNewline + 1);
			fullBuffer = fullBuffer.slice(0, lastNewline);
			this.messageBuffers.push(incompleteMessage);
		}

		// Process the complete messages in the buffer.
		fullBuffer.toString().split("\n").filter((m) => m.trim() !== "").forEach((m) => this.handleMessage(`${m}\n`));
	}

	protected abstract shouldHandleMessage(message: string): boolean;
	protected processUnhandledMessage(_message: string): PromiseOr<void> { }

	public async handleMessage(message: string): Promise<void> {
		this.logTraffic(`<== ${message.trimRight()}\r\n`);

		if (!this.shouldHandleMessage(message.trim())) {
			await this.processUnhandledMessage(message);
			return;
		}

		let msg: unknown;
		try {
			msg = JSON.parse(message);

			if (this.messagesWrappedInBrackets && Array.isArray(msg) && msg.length === 1)
				msg = msg[0];
		} catch (e: unknown) {
			if (this.treatHandlingErrorsAsUnhandledMessages) {
				const err = e as { stack?: string } | undefined;
				this.logger.error(`Unexpected non-JSON message, assuming normal stdout (${String(e)})\n\n${err?.stack}\n\n${message}`);
				await this.processUnhandledMessage(message);
				return;
			} else {
				throw e;
			}
		}

		try {
			const msgObj = msg && typeof msg === "object" ? msg as Record<string, unknown> : undefined;
			if (msgObj && this.isNotification(msgObj))
				void new Promise((resolve) => resolve(this.handleNotification(msgObj as T))).catch((e) => this.logger.error(e));
			else if (msgObj && this.isRequest(msgObj))
				this.processServerRequest(msgObj as unknown as Request<unknown>).catch((e) => this.logger.error(e));
			else if (msgObj && this.isResponse(msgObj))
				this.handleResponse(msgObj as unknown as UnknownResponse).catch((e) => this.logger.error(e));
			else {
				this.logger.error(`Unexpected JSON message, assuming normal stdout : ${message}`);
				new Promise((resolve) => resolve(this.processUnhandledMessage(message))).catch((e) => this.logger.error(e));
			}
		} catch (handlingError: unknown) {
			if (this.treatHandlingErrorsAsUnhandledMessages) {
				const err = handlingError as { stack?: string } | undefined;
				this.logger.error(`Failed to handle JSON message, assuming normal stdout (${String(handlingError)})\n\n${err?.stack}\n\n${message}`);
				new Promise((resolve) => resolve(this.processUnhandledMessage(message))).catch((e) => this.logger.error(e));
			} else {
				throw handlingError;
			}
		}
	}

	protected abstract handleNotification(evt: T): PromiseOr<void>;
	protected handleRequest(_method: string, _args: unknown): Promise<unknown> { return Promise.resolve(undefined); }
	protected isNotification(msg: Record<string, unknown>): boolean { return !!msg.event; }
	protected isRequest(msg: Record<string, unknown>): boolean { return !!msg.method && !!msg.id; }
	protected isResponse(msg: Record<string, unknown>): boolean { return !!msg.id; }

	private async processServerRequest(request: Request<unknown>) {
		let result: unknown;
		let error: unknown;
		try {
			result = await this.handleRequest(request.method, request.params);
		} catch (e) {
			error = e;
		}
		const resp = { id: request.id, result, error };
		const json = this.messagesWrappedInBrackets
			? "[" + JSON.stringify(resp) + "]\r\n"
			: JSON.stringify(resp) + "\r\n";
		this.sendMessage(json);
	}

	private async handleResponse(evt: UnknownResponse): Promise<void> {
		const handler = this.activeRequests[evt.id];
		delete this.activeRequests[evt.id];

		if (handler === "CANCELLED") {
			this.logger.info(`Ignoring response to ${evt.id} because it was cancelled:\n\n${JSON.stringify(evt, undefined, 4)}`);
			return;
		} else if (!handler) {
			this.logger.error(`Unable to handle response with ID ${evt.id} because its handler is not available`);
			return;
		}
		const error = evt.error;

		if (error) {
			await handler[1](error);
		} else {
			await handler[0](evt.result);
		}
	}

	protected notify<TNotification>(subscriptions: Array<(notification: TNotification) => Promise<void> | void>, notification: TNotification): Promise<unknown> {
		const promises = subscriptions.map(async (sub) => await sub(notification));
		return Promise.all(promises).catch((e) => this.logger.error(e));
	}

	protected subscribe<TNotification>(subscriptions: Array<(notification: TNotification) => void>, subscriber: (notification: TNotification) => void): IAmDisposable {
		subscriptions.push(subscriber);
		const disposable = {
			dispose: () => {
				// Remove from the subscription list.
				let index = subscriptions.indexOf(subscriber);
				if (index >= 0) {
					subscriptions.splice(index, 1);
				}

				// Also remove from our disposables (else we'll leak it).
				index = this.disposables.indexOf(disposable);
				if (index >= 0) {
					this.disposables.splice(index, 1);
				}
			},
		};

		this.disposables.push(disposable);

		return disposable;
	}

	protected logTraffic(message: string, isError = false): void {
		if (isError)
			this.logger.error(message);
		else
			this.logger.info(message);

		if (this.openLogFile !== this.logFile && this.logStream) {
			this.logStream.end();
			this.logStream = undefined;
			this.openLogFile = undefined;
		}

		if (!this.logFile)
			return;

		if (!this.logStream) {
			this.logStream = fs.createWriteStream(this.logFile);
			this.logStream.on("error", (e) => {
				this.logger.warn(`Failed to write to log file ${this.logFile}: ${e}`);
				this.logStream = undefined;
				this.openLogFile = undefined;
				this.logFile = undefined;
			});
			this.openLogFile = this.logFile;
		}
		this.logStream.write(`[${(new Date()).toLocaleTimeString()}]: `);
		if (this.maxLogLineLength && message.length > this.maxLogLineLength)
			this.logStream.write(message.substring(0, this.maxLogLineLength) + "…\r\n");
		else
			this.logStream.write(message.trim() + "\r\n");
	}

	public async dispose(): Promise<void> {
		this.isDisposed = true;
		this.cancelAllRequests();

		this.logTraffic(`Process ${this.description} is being disposed`);
		for (const pid of this.additionalPidsToTerminate) {
			try {
				this.logTraffic(`Process ${this.description} is terminating process ${pid}`);
				process.kill(pid);
			} catch (e: unknown) {
				// TODO: Logger knows the category!
				this.logger.error({ message: String(e) });
			}
		}
		this.additionalPidsToTerminate.length = 0;
		try {
			if (!this.processExited && this.process && !this.process.killed) {
				this.logTraffic(`Process ${this.description} is terminating the main process`);
				this.process.kill();
			} else {
				if (this.processExited) {
					this.logTraffic(`Process ${this.description} skipped terminating because it had already exited`);
				} else if (!this.process) {
					this.logTraffic(`Process ${this.description} skipped terminating because there is no process`);
				} else if (this.process?.killed) {
					this.logTraffic(`Process ${this.description} skipped terminating because it was already killed`);
				} else {
					this.logTraffic(`Process ${this.description} skipped terminating because 🤷‍♂️`);
				}
			}
		} catch {
			// This tends to throw a lot because the shell process quit when we terminated the related
			// process above, so just swallow the error.
		}
		this.process = undefined;

		await disposeAllAsync(this.disposables, this.logger);

		// Clear log file so if any more log events come through later, we don't
		// create a new log file and overwrite what we had.
		this.logFile = undefined;

		if (this.logStream) {
			this.logStream.end();
			this.logStream = undefined;
			this.openLogFile = undefined;
		}
	}
}

export interface ProcessExitCodes { code: number | null, signal: NodeJS.Signals | null }
