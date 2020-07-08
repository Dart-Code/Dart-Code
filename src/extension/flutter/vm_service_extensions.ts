import * as vs from "vscode";
import { isWin, TRACK_WIDGET_CREATION_ENABLED } from "../../shared/constants";
import { DebuggerType, VmService, VmServiceExtension } from "../../shared/enums";
import { Logger } from "../../shared/interfaces";
import { SERVICE_CONTEXT_PREFIX, SERVICE_EXTENSION_CONTEXT_PREFIX } from "../extension";
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
	[VmServiceExtension.RepaintRainbow]: keyEnabled,
	[VmServiceExtension.PerformanceOverlay]: keyEnabled,
	[VmServiceExtension.SlowAnimations]: keyTimeDilation,
};

export const timeDilationNormal = 1.0;
export const timeDilationSlow = 5.0;

/// Default values for each service extension.
const defaultToggleExtensionState: { [key: string]: any } = {
	[VmServiceExtension.PlatformOverride]: null, // We don't know the default here so we need to ask for it when the extension loads.
	[VmServiceExtension.DebugBanner]: true,
	[VmServiceExtension.CheckElevations]: false,
	[VmServiceExtension.DebugPaint]: false,
	[VmServiceExtension.PaintBaselines]: false,
	[VmServiceExtension.InspectorSelectMode]: false,
	[VmServiceExtension.RepaintRainbow]: false,
	[VmServiceExtension.PerformanceOverlay]: false,
	[VmServiceExtension.SlowAnimations]: timeDilationNormal,
};

export interface ServiceExtensionArgs { type: VmServiceExtension; params: any; }

/// Manages state for (mostly Flutter) VM service extensions.
export class VmServiceExtensions {
	private registeredServices: { [x in VmService]?: string } = {};
	private loadedServiceExtensions: VmServiceExtension[] = [];
	private currentExtensionState = Object.assign({}, defaultToggleExtensionState);
	private sendValueToVM: (extension: VmServiceExtension) => void;

	constructor(private readonly logger: Logger, sendRequest: (args: ServiceExtensionArgs) => void) {
		// To avoid any code in this class accidentally calling sendRequestToFlutter directly, we wrap it here and don't
		// keep a reference to it.
		this.sendValueToVM = (extension: VmServiceExtension) => {
			// Only ever send values for enabled and known extensions.
			if (this.loadedServiceExtensions.indexOf(extension) !== -1 && toggleExtensionStateKeys[extension] !== undefined) {
				// Build the args in the required format using the correct key and value.
				const params = { [toggleExtensionStateKeys[extension]]: this.currentExtensionState[extension] };
				const args = { type: extension, params };

				sendRequest(args);

				this.syncInspectingWidgetContext(extension);
			}
		};
	}

	/// Handles an event from the Debugger, such as extension services being loaded and values updated.
	public async handleDebugEvent(session: DartDebugSessionInformation, e: vs.DebugSessionCustomEvent): Promise<void> {
		if (e.event === "dart.serviceExtensionAdded") {
			this.handleServiceExtensionLoaded(session, e.body.id);

			try {
				// If the isWidgetCreationTracked extension loads, send a command to the debug adapter
				// asking it to query whether it's enabled (it'll send us an event back with the answer).
				if (e.body.id === "ext.flutter.inspector.isWidgetCreationTracked") {
					// TODO: Why do we send these events to the editor for it to send one back? Why don't we just
					// do the second request in the debug adapter directly and only transmit the result?
					await e.session.customRequest("checkIsWidgetCreationTracked");
					// If it's the PlatformOverride, send a request to get the current value.
				} else if (e.body.id === VmServiceExtension.PlatformOverride) {
					await e.session.customRequest("checkPlatformOverride");
				} else if (e.body.id === VmServiceExtension.InspectorSetPubRootDirectories) {
					// TODO: We should send all open workspaces (arg0, arg1, arg2) so that it
					// works for open packages too.
					const debuggerType: DebuggerType = e.session.configuration.debuggerType;
					if (debuggerType !== DebuggerType.Web) {
						await e.session.customRequest(
							"serviceExtension",
							{
								params: {
									arg0: this.formatPathForPubRootDirectories(e.session.configuration.cwd),
									arg1: e.session.configuration.cwd,
									// TODO: Is this OK???
									isolateId: e.body.isolateId,
								},
								type: "ext.flutter.inspector.setPubRootDirectories",
							},
						);
					}
				}
			} catch (e) {
				this.logger.error(e);
			}
		} else if (e.event === "dart.serviceRegistered") {
			this.handleServiceRegistered(e.body.service, e.body.method);
		} else if (e.event === "dart.flutter.firstFrame") {
			// Send all values back to the VM on the first frame so that they persist across restarts.
			for (const extension in VmServiceExtension)
				this.sendValueToVM(extension as VmServiceExtension);
		} else if (e.event === "dart.flutter.updateIsWidgetCreationTracked") {
			vs.commands.executeCommand("setContext", TRACK_WIDGET_CREATION_ENABLED, e.body.isWidgetCreationTracked);
		} else if (e.event === "dart.flutter.updatePlatformOverride") {
			this.currentExtensionState[VmServiceExtension.PlatformOverride] = e.body.platform;
		} else if (e.event === "dart.flutter.serviceExtensionStateChanged") {
			this.handleRemoteValueUpdate(e.body.extension, e.body.value);
		}
	}

	// TODO: Remove this function (and the call to it) once the fix has rolled to Flutter beta.
	// https://github.com/flutter/flutter-intellij/issues/2217
	private formatPathForPubRootDirectories(path: string | undefined): string | undefined {
		return isWin
			? path && `file:///${path.replace(/\\/g, "/")}`
			: path;
	}

	/// Toggles between two values. Always picks the value1 if the current value
	// is not already value1 (eg. if it's neither of those, it'll pick val1).
	public toggle(id: VmServiceExtension, val1: any = true, val2: any = false) {
		this.currentExtensionState[id] = this.currentExtensionState[id] !== val1 ? val1 : val2;
		this.sendValueToVM(id);
	}

	/// Keep the context in sync so that the "Cancel Inspect Widget" command is enabled/disabled.
	private syncInspectingWidgetContext(id: string) {
		vs.commands.executeCommand("setContext", IS_INSPECTING_WIDGET_CONTEXT, this.currentExtensionState[VmServiceExtension.InspectorSelectMode]);
	}

	/// Handles updates that come from the VM (eg. were updated by another tool).
	private handleRemoteValueUpdate(id: string, value: any) {
		// Don't try to process service extension we don't know about.
		if (this.currentExtensionState[id] === undefined) {
			return;
		}

		// HACK: Everything comes through as strings, but we need bools/ints and sometimes strings,
		// so attempt to parse it, but keep the original string in the case of failure.
		if (typeof value === "string") {
			try {
				value = JSON.parse(value);
			} catch {
			}
		}

		this.currentExtensionState[id] = value;
		this.syncInspectingWidgetContext(id);
	}

	/// Resets all local state to defaults - used when terminating the last debug session (or
	// starting the first) to ensure debug toggles don't "persist" across sessions.
	public resetToDefaults() {
		this.currentExtensionState = Object.assign({}, defaultToggleExtensionState);
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
		vs.commands.executeCommand("setContext", TRACK_WIDGET_CREATION_ENABLED, false);
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
