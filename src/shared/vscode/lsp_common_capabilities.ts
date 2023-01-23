import { ClientCapabilities, FeatureState, StaticFeature } from "vscode-languageclient";


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
			initialize() { },
		};
	}
}
