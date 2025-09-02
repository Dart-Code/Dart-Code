import { ContinuedEvent, Event, OutputEvent } from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";
import { FlutterCapabilities } from "../shared/capabilities/flutter";
import { debugLaunchProgressId, restartReasonManual } from "../shared/constants";
import { DartLaunchArgs } from "../shared/debug/interfaces";
import { LogCategory } from "../shared/enums";
import { AppProgress } from "../shared/flutter/daemon_interfaces";
import { Logger, SpawnedProcess } from "../shared/interfaces";
import { errorString } from "../shared/utils";
import { DartDebugSession } from "./dart_debug_impl";
import { VMEvent } from "./dart_debug_protocol";
import { DebugAdapterLogger } from "./logging";
import { RunDaemonBase } from "./run_daemon_base";

const objectGroupName = "my-group";
const flutterExceptionStartBannerPrefix = "══╡ EXCEPTION CAUGHT BY";
const flutterExceptionEndBannerPrefix = "══════════════════════════════════════════";

export abstract class FlutterDebugSession extends DartDebugSession {
	private runDaemon?: RunDaemonBase;
	private currentRunningAppId?: string;
	private appHasStarted = false;
	private appHasBeenToldToStopOrDetach = false;
	private vmServiceUri?: string;
	protected readonly flutterCapabilities = FlutterCapabilities.empty;

	// Allow flipping into stderr mode for red exceptions when we see the start/end of a Flutter exception dump.
	private outputCategory: "stdout" | "stderr" | "console" = "console";

	constructor() {
		super();

		this.sendStdOutToConsole = false;
		// We get the VM service URI from the `flutter run` process. If we parse
		// it out of verbose logging and connect to it, it'll be before Flutter is
		// finished setting up and bad things can happen (like us sending events
		// way too early).
		this.parseVmServiceUriFromStdOut = false;
		this.requiresProgram = false;
		this.logCategory = LogCategory.FlutterRun;
	}

	protected initializeRequest(
		response: DebugProtocol.InitializeResponse,
		args: DebugProtocol.InitializeRequestArguments,
	): void {
		response.body = response.body || {};
		response.body.supportsRestartRequest = true;
		super.initializeRequest(response, args);
	}

	protected async spawnProcess(args: DartLaunchArgs): Promise<SpawnedProcess> {
		const logger = new DebugAdapterLogger(this, this.logCategory);
		this.expectAdditionalPidToTerminate = true;
		this.runDaemon = this.spawnRunDaemon(args, logger);
		this.runDaemon.registerForUnhandledMessages((msg) => this.handleLogOutput(msg));

		// Set up subscriptions.
		this.runDaemon.registerForDaemonConnect((n) => this.recordAdditionalPid(n.pid));
		this.runDaemon.registerForAppStart((n) => this.currentRunningAppId = n.appId);
		this.runDaemon.registerForAppDebugPort(async (n) => {
			this.vmServiceUri = n.wsUri;
			await this.connectToVmServiceIfReady();
		});
		this.runDaemon.registerForAppStarted(async (n) => {
			this.appHasStarted = true;
			this.outputCategory = "stdout";
			// In modes like Profile, we'll never connect the debugger, so
			// we should end our progress reporting here.
			if (!this.vmServiceUri)
				this.endProgress(debugLaunchProgressId);
			else
				await this.connectToVmServiceIfReady();
			this.sendEvent(new Event("flutter.appStarted"));
		});
		this.runDaemon.registerForAppStop((n) => {
			this.currentRunningAppId = undefined;
			if (this.runDaemon) {
				this.runDaemon.dispose();
				this.runDaemon = undefined;
			}
		});

		this.runDaemon.registerForAppProgress((e) => {
			if (!this.appHasStarted)
				this.sendLaunchProgressEvent(e);
			else
				this.sendProgressEvent(e);
		});
		this.runDaemon.registerForAppWebLaunchUrl((e) => this.sendEvent(new Event("dart.webLaunchUrl", { url: e.url, launched: e.launched })));
		// TODO: Should this use logToUser?
		this.runDaemon.registerForError((err) => this.sendEvent(new OutputEvent(`${err}\n`, "stderr")));
		this.runDaemon.registerForDaemonLog((msg) => this.handleLogOutput(msg.log, msg.error));
		this.runDaemon.registerForAppLog((msg) => this.handleLogOutput(msg.log, msg.error));

		return this.runDaemon.process!;
	}

	private sendLaunchProgressEvent(e: AppProgress) {
		// We ignore finish progress events for launch progress because we use a
		// single ID for launch progress to avoid multiple progress indicators and
		// don't want to hide the overall progress when the first step completes.
		//
		// We'll hide the overall launch progress when we connect to the VM service.
		if (!e.finished && e.message)
			this.updateProgress(debugLaunchProgressId, e.message);
	}

	private sendProgressEvent(e: AppProgress) {
		const progressId = `flutter-${e.appId}-${e.progressId}`;
		if (e.finished) {
			let finalMessage: string | undefined;
			if (!finalMessage) {
				if (e.progressId === "hot.reload")
					finalMessage = "Hot Reload complete!";
				else if (e.progressId === "hot.restart")
					finalMessage = "Hot Restart complete!";
			}
			this.endProgress(progressId, finalMessage);
		} else {
			this.startProgress(progressId, e.message);
		}
	}

	private handleLogOutput(msg: string, forceErrorCategory = false) {
		msg = `${msg.trimRight()}\n`;
		if (msg.includes(flutterExceptionStartBannerPrefix)) {
			// Change before logging.
			this.outputCategory = "stderr";
			this.logToUser(msg, this.outputCategory);
		} else if (msg.includes(flutterExceptionEndBannerPrefix)) {
			// Log before changing back.
			this.logToUser(msg, this.outputCategory);
			this.outputCategory = "stdout";
		} else {
			this.logToUser(msg, forceErrorCategory ? "stderr" : this.outputCategory);
			// This text comes through as stdout and not Progress, so map it over
			// to progress indicator.
			if (msg.includes("Waiting for connection from")) {
				const instructions = "Please click the Dart Debug extension button in the spawned browser window";
				this.updateProgress(debugLaunchProgressId, instructions);
				// Send this delayed, so it appears after the rest of the help text.
				setTimeout(() => this.logToUser(`${instructions}\n`, forceErrorCategory ? "stderr" : this.outputCategory), 10);
			}
		}
	}

	protected abstract spawnRunDaemon(args: DartLaunchArgs, logger: Logger): RunDaemonBase;

	private async connectToVmServiceIfReady() {
		if (this.vmServiceUri && this.appHasStarted && !this.vmService)
			await this.initDebugger(this.vmServiceUri);
	}

	protected async terminate(force: boolean): Promise<void> {
		if (!this.appHasBeenToldToStopOrDetach) {
			this.appHasBeenToldToStopOrDetach = true;
			try {
				if (this.currentRunningAppId && this.appHasStarted && !this.processExited && this.runDaemon) {
					// Request to quit/detach, but don't await it since we sometimes
					// don't get responses before the process quits.
					void this.runDaemon.stop(this.currentRunningAppId);

					// Now wait for the process to terminate up to 3s.
					await Promise.race([
						this.processExit,
						new Promise((resolve) => setTimeout(resolve, 3000)),
					]);
				}
			} catch {
				// Ignore failures here (we're shutting down and will send kill signals).
			}
		}
		await super.terminate(force);
	}

	protected async restartRequest(
		response: DebugProtocol.RestartResponse,
		args: DebugProtocol.RestartArguments,
	): Promise<void> {
		this.sendEvent(new Event("dart.hotRestartRequest"));
		this.sendEvent(new ContinuedEvent(0, true));
		this.reloadPackageMap();
		await this.performReload(true, { reason: restartReasonManual });
		super.restartRequest(response, args);
	}

	private reloadPackageMap(): void {
		// Reload the package map in case the user modified the packages.
		// https://github.com/Dart-Code/Dart-Code/issues/4076.
		this.packageMap?.reload();
	}

	private async performReload(hotRestart: boolean, args?: { reason: string, debounce?: boolean }): Promise<any> {
		if (!this.appHasStarted || !this.currentRunningAppId || !this.runDaemon)
			return;

		const restartType = hotRestart ? "hot-restart" : "hot-reload";

		// To avoid issues with hot restart pausing on exceptions during the restart, we remove
		// exception-pause behaviour here, and it will be re-added as part of the startup code
		// when the new isolate appears.
		if (hotRestart)
			await this.threadManager.setExceptionPauseMode("None", false);

		try {
			await this.runDaemon.restart(this.currentRunningAppId, !this.noDebug, hotRestart, args);
		} catch (e) {
			this.sendEvent(new OutputEvent(`Error running ${restartType}: ${e}\n`, "stderr"));
		}
	}

	protected async customRequest(request: string, response: DebugProtocol.Response, args: any): Promise<void> {
		try {
			switch (request) {
				case "hotReload":
					if (this.currentRunningAppId)
						await this.performReload(false, args as { reason: string, debounce?: boolean });
					this.sendResponse(response);
					break;

				case "hotRestart":
					if (this.currentRunningAppId) {
						this.reloadPackageMap();
						await this.performReload(true, args as { reason: string, debounce?: boolean });
					}
					this.sendResponse(response);
					break;

				default:
					await super.customRequest(request, response, args);
					break;
			}
		} catch (e: any) {
			const error = errorString(e);
			const message = `Error handling '${request}' custom request: ${error}`;

			if (!this.isTerminating)
				this.sendEvent(new OutputEvent(`${message}\n`, "stderr"));
			this.logger.error(message);
			this.errorResponse(response, message);
		}
	}

	protected async handleInspectEvent(event: VMEvent): Promise<void> {
		if (!this.runDaemon || !this.currentRunningAppId)
			return;

		const selectedWidget = await this.runDaemon.callServiceExtension(
			this.currentRunningAppId,
			"ext.flutter.inspector.getSelectedSummaryWidget",
			{ previousSelectionId: null, objectGroup: objectGroupName },
		);
		try {
			if (selectedWidget && selectedWidget.result && selectedWidget.result.creationLocation) {
				const loc = selectedWidget.result.creationLocation;
				const file = loc.file;
				const line = loc.line;
				const column = loc.column;
				this.sendEvent(new Event("dart.navigate", { file, line, column, inOtherEditorColumn: true, fromInspector: true }));
			} else {
				await super.handleInspectEvent(event);
			}
		} finally {
			await this.runDaemon.callServiceExtension(
				this.currentRunningAppId,
				"ext.flutter.inspector.disposeGroup",
				{ objectGroup: objectGroupName },
			);
		}
	}
}
