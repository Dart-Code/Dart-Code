import * as f from "../shared/flutter/daemon_interfaces";
import { IAmDisposable, Logger } from "../shared/interfaces";
import { UnknownNotification, UnknownResponse } from "../shared/services/interfaces";
import { StdIOService } from "../shared/services/stdio_service";

export abstract class RunDaemonBase extends StdIOService<UnknownNotification> {
	constructor(
		public readonly mode: RunMode,
		logFile: string | undefined,
		logger: Logger,
		private readonly urlExposer: (url: string) => Promise<{ url: string }>,
		maxLogLineLength: number,
		messagesWrappedInBrackets: boolean = false,
		treatHandlingErrorsAsUnhandledMessages: boolean = false) {
		super(logger, maxLogLineLength, messagesWrappedInBrackets, treatHandlingErrorsAsUnhandledMessages, logFile);
	}

	protected shouldHandleMessage(message: string): boolean {
		// Everything in daemon is wrapped in [] so we can tell what to handle.
		return message.startsWith("[{") && message.endsWith("}]");
	}

	protected async processUnhandledMessage(message: string): Promise<void> {
		await this.notify(this.unhandledMessageSubscriptions, message);
	}

	private unhandledMessageSubscriptions: Array<(notification: string) => void> = [];
	public registerForUnhandledMessages(subscriber: (notification: string) => void): IAmDisposable {
		return this.subscribe(this.unhandledMessageSubscriptions, subscriber);
	}

	protected async handleRequest(method: string, params: any): Promise<any> {
		switch (method) {
			case "app.exposeUrl":
				return this.urlExposer(params.url);
			default:
				throw new Error(`Unknown request ${method}`);
		}
	}

	// TODO: Can we code-gen all this like the analysis server?

	protected async handleNotification(evt: UnknownNotification): Promise<void> {
		// Always send errors up, no matter where they're from.
		if (evt.params.error) {
			await this.notify(this.errorSubscriptions, evt.params.error as string);
		}
		switch (evt.event) {
			case "daemon.connected":
				await this.notify(this.daemonConnectedSubscriptions, evt.params as f.DaemonConnected);
				break;
			case "app.start":
				await this.notify(this.appStartSubscriptions, evt.params as f.AppStart);
				break;
			case "app.debugPort":
				await this.notify(this.appDebugPortSubscriptions, evt.params as f.AppDebugPort);
				break;
			case "app.started":
				await this.notify(this.appStartedSubscriptions, evt.params as f.AppEvent);
				break;
			case "app.webLaunchUrl":
				await this.notify(this.appWebLaunchUrlSubscriptions, evt.params as f.AppWebLaunchUrl);
				break;
			case "app.stop":
				await this.notify(this.appStopSubscriptions, evt.params as f.AppEvent);
				break;
			case "app.progress":
				await this.notify(this.appProgressSubscriptions, evt.params as f.AppProgress);
				break;
			case "app.log":
				await this.notify(this.appLogSubscriptions, evt.params as f.AppLog);
				break;
			case "daemon.logMessage":
				await this.notify(this.daemonLogMessageSubscriptions, evt.params as f.DaemonLogMessage);
				break;
			case "daemon.log":
				await this.notify(this.daemonLogSubscriptions, evt.params as f.AppLog);
				break;
		}
	}

	// Subscription lists.

	private daemonConnectedSubscriptions: Array<(notification: f.DaemonConnected) => void> = [];
	private appStartSubscriptions: Array<(notification: f.AppStart) => void> = [];
	private appDebugPortSubscriptions: Array<(notification: f.AppDebugPort) => void> = [];
	private appStartedSubscriptions: Array<(notification: f.AppEvent) => void> = [];
	private appStopSubscriptions: Array<(notification: f.AppEvent) => void> = [];
	private appProgressSubscriptions: Array<(notification: f.AppProgress) => void> = [];
	private appWebLaunchUrlSubscriptions: Array<(notification: f.AppWebLaunchUrl) => void> = [];
	private appLogSubscriptions: Array<(notification: f.AppLog) => void> = [];
	private errorSubscriptions: Array<(notification: string) => void> = [];
	private daemonLogMessageSubscriptions: Array<(notification: f.DaemonLogMessage) => void> = [];
	private daemonLogSubscriptions: Array<(notification: f.AppLog) => void> = [];

	// Request methods.

	public restart(appId: string, pause: boolean, hotRestart: boolean, reason: string): Thenable<any> {
		return this.sendRequest("app.restart", { appId, fullRestart: hotRestart === true, pause, reason });
	}

	public detach(appId: string): Thenable<UnknownResponse> {
		return this.sendRequest("app.detach", { appId });
	}

	public stop(appId: string): Thenable<UnknownResponse> {
		return this.sendRequest("app.stop", { appId });
	}

	public callServiceExtension(appId: string, methodName: string, params: any): Promise<any> {
		return this.sendRequest("app.callServiceExtension", { appId, methodName, params });
	}

	// Subscription methods.

	public registerForDaemonConnect(subscriber: (notification: f.DaemonConnected) => void): IAmDisposable {
		return this.subscribe(this.daemonConnectedSubscriptions, subscriber);
	}

	public registerForAppStart(subscriber: (notification: f.AppStart) => void): IAmDisposable {
		return this.subscribe(this.appStartSubscriptions, subscriber);
	}

	public registerForAppDebugPort(subscriber: (notification: f.AppDebugPort) => void): IAmDisposable {
		return this.subscribe(this.appDebugPortSubscriptions, subscriber);
	}

	public registerForAppStarted(subscriber: (notification: f.AppEvent) => void): IAmDisposable {
		return this.subscribe(this.appStartedSubscriptions, subscriber);
	}

	public registerForAppStop(subscriber: (notification: f.AppEvent) => void): IAmDisposable {
		return this.subscribe(this.appStopSubscriptions, subscriber);
	}

	public registerForAppProgress(subscriber: (notification: f.AppProgress) => void): IAmDisposable {
		return this.subscribe(this.appProgressSubscriptions, subscriber);
	}

	public registerForAppWebLaunchUrl(subscriber: (notification: f.AppWebLaunchUrl) => void): IAmDisposable {
		return this.subscribe(this.appWebLaunchUrlSubscriptions, subscriber);
	}

	public registerForAppLog(subscriber: (notification: f.AppLog) => void): IAmDisposable {
		return this.subscribe(this.appLogSubscriptions, subscriber);
	}

	public registerForError(subscriber: (error: string) => void): IAmDisposable {
		return this.subscribe(this.errorSubscriptions, subscriber);
	}

	public registerForDaemonLogMessage(subscriber: (notification: f.DaemonLogMessage) => void): IAmDisposable {
		return this.subscribe(this.daemonLogMessageSubscriptions, subscriber);
	}

	public registerForDaemonLog(subscriber: (notification: f.AppLog) => void): IAmDisposable {
		return this.subscribe(this.daemonLogSubscriptions, subscriber);
	}
}

export enum RunMode {
	Run,
	Attach,
}
