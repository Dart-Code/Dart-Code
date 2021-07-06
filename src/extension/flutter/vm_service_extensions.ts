import * as vs from "vscode";
import { isWin } from "../../shared/constants";
import { VmService, VmServiceExtension } from "../../shared/enums";
import { Logger } from "../../shared/interfaces";
import { getAllProjectFolders } from "../../shared/vscode/utils";
import { DebugCommands, debugSessions } from "../commands/debug";
import { SERVICE_CONTEXT_PREFIX, SERVICE_EXTENSION_CONTEXT_PREFIX } from "../extension";
import { getExcludedFolders } from "../utils";
import { DartDebugSessionInformation } from "../utils/vscode/debug";

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
	[VmServiceExtension.CheckElevations]: keyEnabled,
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
	/// Extension values owned by us. If someone else updates a value, we should
	/// remove it from here.
	private currentExtensionValues: { [key: string]: any } = {};

	constructor(private readonly logger: Logger, private readonly debugCommands: DebugCommands) {
		this.debugCommands.onWillHotRestart(() => this.markAllServicesUnloaded());
	}

	/// Handles an event from the Debugger, such as extension services being loaded and values updated.
	public async handleDebugEvent(session: DartDebugSessionInformation, e: vs.DebugSessionCustomEvent): Promise<void> {
		if (e.event === "dart.serviceExtensionAdded") {
			this.handleServiceExtensionLoaded(session, e.body.id);

			try {
				if (e.body.id === VmServiceExtension.InspectorSetPubRootDirectories) {
					const projectFolders = await getAllProjectFolders(this.logger, getExcludedFolders, { requirePubspec: true });

					const params: { [key: string]: string } = {
						// TODO: Is this OK???
						isolateId: e.body.isolateId,
					};

					let argNum = 0;
					for (const projectFolder of projectFolders) {
						params[`arg${argNum++}`] = projectFolder;
						if (isWin)
							params[`arg${argNum++}`] = this.formatPathForPubRootDirectories(projectFolder);
					}

					await e.session.customRequest(
						"serviceExtension",
						{
							params,
							type: "ext.flutter.inspector.setPubRootDirectories",
						},
					);
				}
			} catch (e) {
				this.logger.error(e);
			}
		} else if (e.event === "dart.serviceRegistered") {
			this.handleServiceRegistered(e.body.service, e.body.method);
		} else if (e.event === "dart.flutter.serviceExtensionStateChanged") {
			this.handleRemoteValueUpdate(e.body.extension, e.body.value);
		}
	}

	// TODO: Remove this function (and the call to it) once the fix has rolled to Flutter beta.
	// https://github.com/flutter/flutter-intellij/issues/2217
	private formatPathForPubRootDirectories(path: string): string {
		return isWin
			? path && `file:///${path.replace(/\\/g, "/")}`
			: path;
	}

	/// Toggles between two values. Always picks the value1 if the current value
	// is not already value1 (eg. if it's neither of those, it'll pick val1).
	public async toggle(id: VmServiceExtension, val1: any = true, val2: any = false): Promise<void> {
		/// Helper that toggles for one session.
		const toggleForSession = async (session: DartDebugSessionInformation) => {
			const currentValue = await this.getCurrentServiceExtensionValue(session.session, id);
			const newValue = currentValue !== val1 ? val1 : val2;
			this.currentExtensionValues[id] = newValue;
			await this.sendExtensionValue(session.session, id, newValue);
		};

		await Promise.all(debugSessions.map((session) => toggleForSession(session).catch((e) => this.logger.error(e))));
	}

	public async getCurrentServiceExtensionValue(session: vs.DebugSession, id: VmServiceExtension) {
		const responseBody = await session.customRequest("serviceExtension", { type: id });
		return this.extractServiceValue(responseBody[toggleExtensionStateKeys[id]]);
	}

	public async sendExtensionValue(session: vs.DebugSession, id: VmServiceExtension, value: unknown) {
		const params = { [toggleExtensionStateKeys[id]]: value };
		await session.customRequest("serviceExtension", { type: id, params });
	}

	/// Handles updates that come from the VM (eg. were updated by another tool).
	private handleRemoteValueUpdate(id: string, value: any) {
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
	private handleServiceRegistered(service: VmService, method: string) {
		this.registeredServices[service] = method;
		vs.commands.executeCommand("setContext", `${SERVICE_CONTEXT_PREFIX}${service}`, true);
	}

	/// Tracks loaded service extensions and updates contexts to enable VS Code commands.
	private handleServiceExtensionLoaded(session: DartDebugSessionInformation, id: VmServiceExtension) {
		session.loadedServiceExtensions.push(id);
		this.loadedServiceExtensions.push(id);
		vs.commands.executeCommand("setContext", `${SERVICE_EXTENSION_CONTEXT_PREFIX}${id}`, true);

		// If this extension is one we have an override value for, then this must be the extension loading
		// for a new isolate (perhaps after a restart), so send its value.
		// Only ever send values for enabled and known extensions.
		const isTogglableService = toggleExtensionStateKeys[id] !== undefined;
		const value = this.currentExtensionValues[id];
		const hasValue = value !== undefined;

		if (isTogglableService && hasValue)
			this.sendExtensionValue(session.session, id, value).catch((e) => this.logger.error(e));
	}

	/// Marks all services and service extensions as not-loaded in the context to disable VS Code Commands.
	public markAllServicesUnloaded() {
		for (const id of Object.keys(this.registeredServices)) {
			vs.commands.executeCommand("setContext", `${SERVICE_CONTEXT_PREFIX}${id}`, undefined);
		}
		this.registeredServices = {};
		for (const id of this.loadedServiceExtensions) {
			vs.commands.executeCommand("setContext", `${SERVICE_EXTENSION_CONTEXT_PREFIX}${id}`, undefined);
		}
		this.loadedServiceExtensions.length = 0;
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
