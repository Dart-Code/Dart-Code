import * as vs from "vscode";
import { isWin } from "../../shared/constants";
import { FlutterService, FlutterServiceExtension } from "../../shared/enums";
import { SERVICE_CONTEXT_PREFIX, SERVICE_EXTENSION_CONTEXT_PREFIX } from "../extension";
import { DebuggerType, TRACK_WIDGET_CREATION_ENABLED } from "../providers/debug_config_provider";

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
	[FlutterServiceExtension.PlatformOverride]: keyValue,
	[FlutterServiceExtension.DebugBanner]: keyEnabled,
	[FlutterServiceExtension.CheckElevations]: keyEnabled,
	[FlutterServiceExtension.DebugPaint]: keyEnabled,
	[FlutterServiceExtension.PaintBaselines]: keyEnabled,
	[FlutterServiceExtension.InspectorSelectMode]: keyEnabled,
	[FlutterServiceExtension.RepaintRainbow]: keyEnabled,
	[FlutterServiceExtension.PerformanceOverlay]: keyEnabled,
	[FlutterServiceExtension.SlowAnimations]: keyTimeDilation,
};

export const timeDilationNormal = 1.0;
export const timeDilationSlow = 5.0;

/// Default values for each service extension.
const defaultToggleExtensionState: { [key: string]: any } = {
	[FlutterServiceExtension.PlatformOverride]: null, // We don't know the default here so we need to ask for it when the extension loads.
	[FlutterServiceExtension.DebugBanner]: true,
	[FlutterServiceExtension.CheckElevations]: false,
	[FlutterServiceExtension.DebugPaint]: false,
	[FlutterServiceExtension.PaintBaselines]: false,
	[FlutterServiceExtension.InspectorSelectMode]: false,
	[FlutterServiceExtension.RepaintRainbow]: false,
	[FlutterServiceExtension.PerformanceOverlay]: false,
	[FlutterServiceExtension.SlowAnimations]: timeDilationNormal,
};

export interface FlutterServiceExtensionArgs { type: FlutterServiceExtension; params: any; }

/// Manages state for Flutter VM service extensions.
export class FlutterVmServiceExtensions {
	private registeredServices: { [x in FlutterService]?: string } = {};
	private loadedServiceExtensions: FlutterServiceExtension[] = [];
	private currentExtensionState = Object.assign({}, defaultToggleExtensionState);
	private sendValueToVM: (extension: FlutterServiceExtension) => void;

	constructor(sendRequest: (extension: FlutterServiceExtension, args: FlutterServiceExtensionArgs) => void) {
		// To avoid any code in this class accidentally calling sendRequestToFlutter directly, we wrap it here and don't
		// keep a reference to it.
		this.sendValueToVM = (extension: FlutterServiceExtension) => {
			// Only ever send values for enabled and known extensions.
			if (this.loadedServiceExtensions.indexOf(extension) !== -1 && toggleExtensionStateKeys[extension] !== undefined) {
				// Build the args in the required format using the correct key and value.
				const params = { [toggleExtensionStateKeys[extension]]: this.currentExtensionState[extension] };
				const args = { type: extension, params };

				sendRequest(extension, args);

				this.syncInspectingWidgetContext(extension);
			}
		};
	}

	/// Handles an event from the Debugger, such as extension services being loaded and values updated.
	public handleDebugEvent(e: vs.DebugSessionCustomEvent): void {
		if (e.event === "dart.serviceExtensionAdded") {
			this.handleServiceExtensionLoaded(e.body.id);

			// If the isWidgetCreationTracked extension loads, send a command to the debug adapter
			// asking it to query whether it's enabled (it'll send us an event back with the answer).
			if (e.body.id === "ext.flutter.inspector.isWidgetCreationTracked") {
				e.session.customRequest("checkIsWidgetCreationTracked");
				// If it's the PlatformOverride, send a request to get the current value.
			} else if (e.body.id === FlutterServiceExtension.PlatformOverride) {
				e.session.customRequest("checkPlatformOverride");
			} else if (e.body.id === FlutterServiceExtension.InspectorSetPubRootDirectories) {
				// TODO: We should send all open workspaces (arg0, arg1, arg2) so that it
				// works for open packages too.
				const debuggerType: DebuggerType = e.session.configuration.debuggerType;
				if (debuggerType !== DebuggerType.FlutterWeb) {
					e.session.customRequest(
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
		} else if (e.event === "dart.serviceRegistered") {
			this.handleServiceRegistered(e.body.service, e.body.method);
		} else if (e.event === "dart.flutter.firstFrame") {
			// Send all values back to the VM on the first frame so that they persist across restarts.
			for (const extension in FlutterServiceExtension)
				this.sendValueToVM(extension as FlutterServiceExtension);
		} else if (e.event === "dart.flutter.updateIsWidgetCreationTracked") {
			vs.commands.executeCommand("setContext", TRACK_WIDGET_CREATION_ENABLED, e.body.isWidgetCreationTracked);
		} else if (e.event === "dart.flutter.updatePlatformOverride") {
			this.currentExtensionState[FlutterServiceExtension.PlatformOverride] = e.body.platform;
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
	public toggle(id: FlutterServiceExtension, val1: any = true, val2: any = false) {
		this.currentExtensionState[id] = this.currentExtensionState[id] !== val1 ? val1 : val2;
		this.sendValueToVM(id);
	}

	/// Keep the context in sync so that the "Cancel Inspect Widget" command is enabled/disabled.
	private syncInspectingWidgetContext(id: string) {
		vs.commands.executeCommand("setContext", IS_INSPECTING_WIDGET_CONTEXT, this.currentExtensionState[FlutterServiceExtension.InspectorSelectMode]);
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
	private handleServiceRegistered(service: FlutterService, method: string) {
		this.registeredServices[service] = method;
		vs.commands.executeCommand("setContext", `${SERVICE_CONTEXT_PREFIX}${service}`, true);
	}

	/// Tracks loaded service extensions and updates contexts to enable VS Code commands.
	private handleServiceExtensionLoaded(id: FlutterServiceExtension) {
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
	public serviceIsRegistered(service: FlutterService): boolean {
		return !!this.registeredServices[service];
	}

	public getServiceMethodName(service: FlutterService): string | undefined {
		return this.registeredServices[service];
	}

	public serviceExtensionIsLoaded(id: FlutterServiceExtension) {
		return !!this.loadedServiceExtensions.find((loadedID) => loadedID === id);
	}
}
