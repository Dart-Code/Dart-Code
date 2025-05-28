import * as vs from "vscode";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { isDartCodeTestRun, isWin } from "../../shared/constants";
import { SERVICE_CONTEXT_PREFIX, SERVICE_EXTENSION_CONTEXT_PREFIX } from "../../shared/constants.contexts";
import { VmService, VmServiceExtension } from "../../shared/enums";
import { Logger } from "../../shared/interfaces";
import { fsPath } from "../../shared/utils/fs";
import { DartDebugSessionInformation } from "../../shared/vscode/interfaces";
import { getDartWorkspaceFolders } from "../../shared/vscode/utils";
import { WorkspaceContext } from "../../shared/workspace";
import { DebugCommands, debugSessions } from "../commands/debug";

export const IS_INSPECTING_WIDGET_CONTEXT = "dart-code:flutter.isInspectingWidget";

const keyTimeDilation = "timeDilation";
const keyEnabled = "enabled";
const keyValue = "value";

/// Service extension values must be wrapped in objects when sent to the VM, eg:
///
///     { timeDilation: x.x }
///     { enabled: true }
///
/// This map tracks the name of the key for a given extension.
const toggleExtensionStateKeys: { [key: string]: string } = {
	[VmServiceExtension.PlatformOverride]: keyValue,
	[VmServiceExtension.DebugBanner]: keyEnabled,
	[VmServiceExtension.DebugPaint]: keyEnabled,
	[VmServiceExtension.PaintBaselines]: keyEnabled,
	[VmServiceExtension.InspectorSelectMode]: keyEnabled,
	[VmServiceExtension.BrightnessOverride]: keyValue,
	[VmServiceExtension.RepaintRainbow]: keyEnabled,
	[VmServiceExtension.PerformanceOverlay]: keyEnabled,
	[VmServiceExtension.SlowAnimations]: keyTimeDilation,
};

export const timeDilationNormal = 1.0;
export const timeDilationSlow = 5.0;

export interface ServiceExtensionArgs { type: VmServiceExtension; params: any; }

/// Manages state for (mostly Flutter) VM service extensions.
export class VmServiceExtensions {
	private registeredServices: { [x in VmService]?: string } = {};
	private loadedServiceExtensions: VmServiceExtension[] = [];
	private readonly loadedServiceExtensionIsolateIds = new Map<VmServiceExtension, string>();
	/// Extension values owned by us. If someone else updates a value, we should
	/// remove it from here.
	private currentExtensionValues: { [key: string]: any } = {};

	constructor(
		private readonly logger: Logger,
		private readonly debugCommands: DebugCommands,
		private readonly workspaceContext: WorkspaceContext,
		private readonly flutterCapabilities: FlutterCapabilities,
	) {
		this.debugCommands.onWillHotRestart(() => this.markAllServiceExtensionsUnloaded());
	}

	/// Handles an event from the Debugger, such as extension services being loaded and values updated.
	public async handleDebugEvent(session: DartDebugSessionInformation, e: vs.DebugSessionCustomEvent): Promise<void> {
		if (e.event === "dart.serviceExtensionAdded") {
			this.handleServiceExtensionLoaded(session, e.body.extensionRPC as VmServiceExtension, e.body.isolateId as string | null | undefined);

			const useAddPubRootDirectories = this.flutterCapabilities.supportsAddPubRootDirectories;
			const pubRootDirectoriesService = useAddPubRootDirectories
				? VmServiceExtension.InspectorAddPubRootDirectories
				: VmServiceExtension.InspectorSetPubRootDirectories;

			try {
				if (e.body.extensionRPC === pubRootDirectoriesService) {
					const params: { [key: string]: string } = {
						// TODO: Is this OK???
						isolateId: e.body.isolateId,
					};

					let argNum = 0;
					for (const workspaceFolder of getDartWorkspaceFolders()) {
						params[`arg${argNum++}`] = this.formatPathForPubRootDirectories(fsPath(workspaceFolder.uri));
					}

					await this.callServiceExtension(e.session, pubRootDirectoriesService, params);
				}
			} catch (e: any) {
				if (!this.shouldSilenceError(e)) {
					this.logger.error(e);
				}
			}
		} else if (e.event === "dart.serviceRegistered") {
			this.handleServiceRegistered(e.body.service as VmService, e.body.method as string);
		} else if (e.event === "flutter.serviceExtensionStateChanged") {
			this.handleRemoteValueUpdate(e.body.extension as string, e.body.value);
		}
	}

	private shouldSilenceError(e: any) {
		return isDartCodeTestRun && "message" in e && typeof e.message === "string" && e.message.includes("Service connection disposed");
	}

	private formatPathForPubRootDirectories(path: string): string {
		if (isWin) {
			return path && `file:///${path.replace(/\\/g, "/")}`;
		}

		// TODO(helin24): Use DDS for this translation.
		const search = "/google3/";
		if (this.workspaceContext.config.forceFlutterWorkspace && path.startsWith("/google") && path.includes(search)) {
			const idx = path.indexOf(search);
			const remainingPath = path.substring(idx + search.length);
			return `google3:///${remainingPath}`;
		}

		return path;
	}

	public async overridePlatform() {
		const selection = await vs.window.showQuickPick([
			{ label: "Android", platform: "android" },
			{ label: "iOS", platform: "iOS" },
			{ label: "macOS", platform: "macOS" },
			{ label: "Windows", platform: "windows" },
			{ label: "Linux", platform: "linux" },
		]);
		if (!selection)
			return;
		// Pass the same value for both options as we will always set it.
		return this.toggle(VmServiceExtension.PlatformOverride, selection.platform, selection.platform);
	}

	/// Toggles between two values. Always picks the value1 if the current value
	/// is not already value1 (eg. if it's neither of those, it'll pick val1).
	public async toggle(id: VmServiceExtension, val1: any = true, val2: any = false): Promise<void> {
		/// Helper that toggles for one session.
		const toggleForSession = async (session: DartDebugSessionInformation) => {
			const newValue = val1 === val2
				? val1
				: await this.getCurrentServiceExtensionValue(session.session, id) !== val1
					? val1
					: val2;
			this.currentExtensionValues[id] = newValue;
			await this.sendExtensionValue(session.session, id, newValue);
		};

		await Promise.all(debugSessions.map((session) => toggleForSession(session).catch((e) => this.logger.error(e))));
	}

	public async getCurrentServiceExtensionValue(session: vs.DebugSession, method: VmServiceExtension) {
		const responseBody = await this.callServiceExtension(session, method);
		return this.extractServiceValue(responseBody[toggleExtensionStateKeys[method]]);
	}

	public async sendExtensionValue(session: vs.DebugSession, method: VmServiceExtension, value: unknown) {
		const params = { [toggleExtensionStateKeys[method]]: value };
		await this.callServiceExtension(session, method, params);
	}

	private async callServiceExtension(session: vs.DebugSession, method: VmServiceExtension, params?: any) {
		if (!params?.isolateId) {
			params = params || {};
			params.isolateId = this.loadedServiceExtensionIsolateIds.get(method);
		}
		return await session.customRequest("callService", { method, params });
	}

	private syncContextStates(id: string, value: any) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
		if (id === VmServiceExtension.InspectorSelectMode) {
			/// Keep the context in sync so that the "Cancel Inspect Widget" command is enabled/disabled.
			void vs.commands.executeCommand("setContext", IS_INSPECTING_WIDGET_CONTEXT, !!value);
			this.debugCommands.isInspectingWidget = !!value;
		}
	}

	/// Handles updates that come from the VM (eg. were updated by another tool).
	private handleRemoteValueUpdate(id: string, value: any) {
		this.syncContextStates(id, value);

		// Don't try to process service extension we don't know about.
		if (this.currentExtensionValues[id] === undefined)
			return;

		value = this.extractServiceValue(value);

		// If someone else updated it to something different to the value we're
		// overriding, then remove our override.
		if (this.currentExtensionValues[id] !== value)
			delete this.currentExtensionValues[id];
	}

	private extractServiceValue(value: any) {
		// HACK: Everything comes through as strings, but we need bools/ints and sometimes strings,
		// so attempt to parse it, but keep the original string in the case of failure.
		if (typeof value === "string") {
			try {
				value = JSON.parse(value);
			} catch {
			}
		}
		return value;
	}

	/// Resets all local state to defaults - used when terminating the last debug session (or
	// starting the first) to ensure debug toggles don't "persist" across sessions.
	public resetToDefaults() {
		this.currentExtensionValues = {};
	}

	/// Tracks registered services and updates contexts to enable VS Code commands.
	public handleServiceRegistered(service: VmService, method: string) {
		this.registeredServices[service] = method;
		void vs.commands.executeCommand("setContext", `${SERVICE_CONTEXT_PREFIX}${service}`, true);
	}

	/// Tracks loaded service extensions and updates contexts to enable VS Code commands.
	private handleServiceExtensionLoaded(session: DartDebugSessionInformation, extensionRPC: VmServiceExtension, isolateId: string | undefined | null) {
		session.loadedServiceExtensions.push(extensionRPC);
		this.loadedServiceExtensions.push(extensionRPC);
		if (isolateId)
			this.loadedServiceExtensionIsolateIds.set(extensionRPC, isolateId);
		void vs.commands.executeCommand("setContext", `${SERVICE_EXTENSION_CONTEXT_PREFIX}${extensionRPC}`, true);

		// If this extension is one we have an override value for, then this must be the extension loading
		// for a new isolate (perhaps after a restart), so send its value.
		// Only ever send values for enabled and known extensions.
		const isTogglableService = toggleExtensionStateKeys[extensionRPC] !== undefined;
		const value = this.currentExtensionValues[extensionRPC];
		const hasValue = value !== undefined;

		if (isTogglableService && hasValue) {
			this.sendExtensionValue(session.session, extensionRPC, value).catch((e) => {
				if (!this.shouldSilenceError(e)) {
					this.logger.error(e);
				}
			});
		}
	}

	/// Marks all services as not-loaded (happens after session ends).
	public markAllServicesUnloaded() {
		for (const id of Object.keys(this.registeredServices)) {
			void vs.commands.executeCommand("setContext", `${SERVICE_CONTEXT_PREFIX}${id}`, undefined);
		}
		this.registeredServices = {};
	}

	/// Marks all service extensions as not-loaded (happens after session ends or after hot restart).
	public markAllServiceExtensionsUnloaded() {
		for (const id of this.loadedServiceExtensions) {
			void vs.commands.executeCommand("setContext", `${SERVICE_EXTENSION_CONTEXT_PREFIX}${id}`, undefined);
		}
		this.loadedServiceExtensions.length = 0;
		this.loadedServiceExtensionIsolateIds.clear();
	}

	// TODO: These services should be per-session!
	public serviceIsRegistered(service: VmService): boolean {
		return !!this.registeredServices[service];
	}

	public getServiceMethodName(service: VmService): string | undefined {
		return this.registeredServices[service];
	}

	public serviceExtensionIsLoaded(id: VmServiceExtension) {
		return !!this.loadedServiceExtensions.find((loadedID) => loadedID === id);
	}
}
