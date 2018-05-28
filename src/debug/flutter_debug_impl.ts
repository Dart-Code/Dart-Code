import * as path from "path";
import { Event, OutputEvent } from "vscode-debugadapter";
import { DebugProtocol } from "vscode-debugprotocol";
import { DartDebugSession } from "./dart_debug_impl";
import { VMEvent } from "./dart_debug_protocol";
import { FlutterRun } from "./flutter_run";
import { FlutterLaunchRequestArguments, formatPathForVm, uriToFilePath } from "./utils";

export class FlutterDebugSession extends DartDebugSession {
	private flutter: FlutterRun;
	private currentRunningAppId: string;
	private appHasStarted = false;
	private observatoryUri: string;
	private baseUri: string;
	private noDebug: boolean;
	private isReloadInProgress: boolean;

	constructor() {
		super();

		this.sendStdOutToConsole = false;
	}

	protected initializeRequest(
		response: DebugProtocol.InitializeResponse,
		args: DebugProtocol.InitializeRequestArguments,
	): void {
		response.body.supportsRestartRequest = true;
		super.initializeRequest(response, args);
	}

	protected spawnProcess(args: FlutterLaunchRequestArguments): any {
		this.noDebug = args.noDebug;
		const debug = !args.noDebug;
		let appArgs = [];

		appArgs.push("-t");
		appArgs.push(this.sourceFileForArgs(args));

		if (args.deviceId) {
			appArgs.push("-d");
			appArgs.push(args.deviceId);
		}

		if (args.flutterMode === "profile") {
			appArgs.push("--profile");
		} else if (args.flutterMode === "release") {
			appArgs.push("--release");
		}

		if (debug) {
			appArgs.push("--start-paused");
		}

		if (args.args) {
			appArgs = appArgs.concat(args.args);
		}

		if (args.showMemoryUsage) {
			this.pollforMemoryMs = 1000;
		}

		// Normally for `flutter run` we don't allow terminating the pid we get from Observatory,
		// because it's on a remote device, however in the case of the flutter-tester, it is local
		// and otherwise might be left hanging around.
		this.allowTerminatingObservatoryVmPid = args.deviceId === "flutter-tester";

		this.flutter = new FlutterRun(args.flutterPath, args.cwd, appArgs, args.flutterRunLogFile);
		this.flutter.registerForUnhandledMessages((msg) => this.logToUser(msg));

		// Set up subscriptions.
		this.flutter.registerForAppStart((n) => this.currentRunningAppId = n.appId);
		this.flutter.registerForAppDebugPort((n) => { this.observatoryUri = n.wsUri; this.baseUri = n.baseUri; });
		this.flutter.registerForAppStarted((n) => {
			this.appHasStarted = true;
			if (!args.noDebug && this.observatoryUri)
				this.initObservatory(this.observatoryUri);
		});
		this.flutter.registerForAppStop((n) => { this.currentRunningAppId = undefined; this.flutter.dispose(); });
		this.flutter.registerForAppProgress((e) => this.sendEvent(new Event("dart.progress", { message: e.message, finished: e.finished })));
		this.flutter.registerForError((err) => this.sendEvent(new OutputEvent(err, "stderr")));

		return this.flutter.process;
	}

	/***
	 * Converts a source path to an array of possible uris.
	 *
	 * For flutter we need to extend the Dart implementation by also providing uris
	 * using the baseUri value returned from `flutter run` to match the fs path
	 * on the device running the application in order for breakpoints to match the
	 * patched `hot reload` code.
	 */
	protected getPossibleSourceUris(sourcePath: string): string[] {
		const allUris = super.getPossibleSourceUris(sourcePath);
		if (this.cwd) {
			const projectUri = formatPathForVm(this.cwd);

			// Map any paths over to the device-local paths.
			allUris.slice().forEach((uri) => {
				if (uri.startsWith(projectUri)) {
					const relativePath = uri.substr(projectUri.length);
					const mappedPath = path.join(this.baseUri, relativePath);
					const newUri = formatPathForVm(mappedPath);
					allUris.push(newUri);
				}
			});
		}

		return allUris;
	}

	protected convertVMUriToSourcePath(uri: string): string {
		// Note: Flutter device paths (and baseUri) are always linux-y (not Windows) so we need to
		// force Linux format for remote paths.

		let localPath = super.convertVMUriToSourcePath(uri);
		const localPathLinux = super.convertVMUriToSourcePath(uri, false);

		// If the path is the baseUri given by flutter, we need to rewrite it into a local path for this machine.
		const basePath = uriToFilePath(this.baseUri, false);
		if (localPathLinux.startsWith(basePath) && this.cwd)
			localPath = path.join(this.cwd, path.relative(basePath, localPathLinux));

		return localPath;
	}

	protected async disconnectRequest(
		response: DebugProtocol.DisconnectResponse,
		args: DebugProtocol.DisconnectArguments,
	): Promise<void> {
			if (this.currentRunningAppId && this.appHasStarted)
				await this.flutter.stop(this.currentRunningAppId);
		super.disconnectRequest(response, args);
	}

	protected restartRequest(
		response: DebugProtocol.RestartResponse,
		args: DebugProtocol.RestartArguments,
	): void {
		this.performReload(false);
		// Notify the Extension we had a restart request so it's able to
		// log the hotReload.
		this.sendEvent(new Event("dart.restartRequest"));
		super.restartRequest(response, args);
	}

	private performReload(hotRestart: boolean): Thenable<any> {
		if (this.isReloadInProgress) {
			this.sendEvent(new OutputEvent("Reload already in progress, ignoring request", "stderr"));
			return;
		}
		this.isReloadInProgress = true;
		return this.flutter.restart(this.currentRunningAppId, !this.noDebug, hotRestart)
			.then(
				(result) => {
					// If we get a hint, send it back over to the UI to do something appropriate.
					if (result && result.hintId)
						this.sendEvent(new Event("dart.hint", { hintId: result.hintId, hintMessage: result.hintMessage }));
				},
				(error) => this.sendEvent(new OutputEvent(error, "stderr")),
		)
			.then(() => this.isReloadInProgress = false);
	}

	protected customRequest(request: string, response: DebugProtocol.Response, args: any): void {
		switch (request) {
			case "serviceExtension":
				if (this.currentRunningAppId)
					this.flutter.callServiceExtension(this.currentRunningAppId, args.type, args.params)
						// tslint:disable-next-line:no-empty
						.then((result) => { }, (error) => this.sendEvent(new OutputEvent(error, "stderr")));
				break;

			case "togglePlatform":
				if (this.currentRunningAppId)
					this.flutter.callServiceExtension(this.currentRunningAppId, "ext.flutter.platformOverride", null).then(
						(result) => {
							this.flutter.callServiceExtension(this.currentRunningAppId, "ext.flutter.platformOverride", { value: result.value === "android" ? "iOS" : "android" })
								// tslint:disable-next-line:no-empty
								.then((result) => { }, (error) => this.sendEvent(new OutputEvent(error, "stderr")));
						},
						(error) => this.sendEvent(new OutputEvent(error, "stderr")),
					);
				break;

			case "hotReload":
				if (this.currentRunningAppId)
					this.performReload(false);
				break;

			case "hotRestart":
				if (this.currentRunningAppId)
					this.performReload(true);
				break;

			default:
				super.customRequest(request, response, args);
				break;
		}
	}

	// Extension
	public handleExtensionEvent(event: VMEvent) {
		if (event.kind === "Extension" && event.extensionKind === "Flutter.FirstFrame") {
			this.sendEvent(new Event("dart.flutter.firstFrame", {}));
		} else {
			super.handleExtensionEvent(event);
		}
	}
}
