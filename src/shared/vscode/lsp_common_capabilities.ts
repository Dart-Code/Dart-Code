import { commands } from "vscode";
import { ClientCapabilities, FeatureState, ServerCapabilities, StaticFeature } from "vscode-languageclient";
import { LSP_COMMAND_CONTEXT_PREFIX } from "../constants";


export class CommonCapabilitiesFeature {
	public get feature(): StaticFeature {
		return {
			dispose() { },
			fillClientCapabilities(capabilities: ClientCapabilities) {
				capabilities.experimental = capabilities.experimental ?? {};
				// Set an explicit flag to let the server know we support the window/showMessage request
				// because there's no existing capability for this (yet) and some client do not support it.
				// https://github.com/microsoft/language-server-protocol/issues/1635
				capabilities.experimental.supportsWindowShowMessageRequest = true;
			},
			getState(): FeatureState {
				return { kind: "static" };
			},
			initialize(capabilities: ServerCapabilities) {
				// Track known commands (that we might care about) so we can
				// clear the contexts when we re-initialize so if you switch to an
				// older SDK we handle it correctly.
				const knownCommands = [
					"dart.edit.sortMembers",
					"dart.edit.organizeImports",
					"dart.edit.fixAll",
					"dart.edit.fixAllInWorkspace.preview",
					"dart.edit.fixAllInWorkspace",
					"dart.edit.sendWorkspaceEdit",
				];
				const supportedCommands = capabilities.executeCommandProvider?.commands;
				if (supportedCommands) {
					const supportedCommandsSet = new Set<string>(supportedCommands);
					for (const command of knownCommands) {
						void commands.executeCommand("setContext", `${LSP_COMMAND_CONTEXT_PREFIX}${command}`, supportedCommandsSet.has(command));
					}
				}
			},
		};
	}
}


