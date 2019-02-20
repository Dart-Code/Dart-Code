import * as f from "../flutter/flutter_types";
import { StdIOService, UnknownNotification, UnknownResponse } from "../services/stdio_service";
import { globalFlutterArgs } from "../utils/processes";
import { IAmDisposable, LogSeverity } from "./utils";

export class FlutterRun extends StdIOService<UnknownNotification> {
	constructor(public mode: RunMode, flutterBinPath: string, projectFolder: string, args: string[], envOverrides: any, logFile: string, logger: (message: string, severity: LogSeverity) => void, maxLogLineLength: number) {
		super(() => logFile, logger, maxLogLineLength, true, true);

		const command = mode === RunMode.Attach ? "attach" : "run";

		this.createProcess(projectFolder, flutterBinPath, globalFlutterArgs.concat([command, "--machine"]).concat(args), envOverrides);
	}

	protected shouldHandleMessage(message: string): boolean {
		// Everything in flutter is wrapped in [] so we can tell what to handle.
		return message.startsWith("[{") && message.endsWith("}]");
	}

	protected processUnhandledMessage(message: string): void {
		this.notify(this.unhandledMessageSubscriptions, message);
	}

	private unhandledMessageSubscriptions: Array<(notification: string) => void> = [];
	public registerForUnhandledMessages(subscriber: (notification: string) => void): IAmDisposable {
		return this.subscribe(this.unhandledMessageSubscriptions, subscriber);
	}

	// TODO: Can we code-gen all this like the analysis server?

	protected handleNotification(evt: UnknownNotification) {
		// Always send errors up, no matter where they're from.
		if (evt.params.error) {
			this.notify(this.errorSubscriptions, evt.params.error as string);
		}
		switch (evt.event) {
			case "daemon.connected":
				this.notify(this.daemonConnectedSubscriptions, evt.params as f.DaemonConnected);
				break;
			case "app.start":
				this.notify(this.appStartSubscriptions, evt.params as f.AppStart);
				break;
			case "app.debugPort":
				this.notify(this.appDebugPortSubscriptions, evt.params as f.AppDebugPort);
				break;
			case "app.started":
				this.notify(this.appStartedSubscriptions, evt.params as f.AppEvent);
				break;
			case "app.stop":
				this.notify(this.appStopSubscriptions, evt.params as f.AppEvent);
				break;
			case "app.progress":
				this.notify(this.appProgressSubscriptions, evt.params as f.AppProgress);
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
	private errorSubscriptions: Array<(notification: string) => void> = [];

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

	public callServiceExtension(appId: string, methodName: string, params: any): Thenable<any> {
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

	public registerForError(subscriber: (error: string) => void): IAmDisposable {
		return this.subscribe(this.errorSubscriptions, subscriber);
	}
}

export enum RunMode {
	Run,
	Attach,
}
