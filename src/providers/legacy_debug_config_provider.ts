import { DebugConfigurationProvider, WorkspaceFolder, CancellationToken, DebugConfiguration, ProviderResult } from "vscode";
import { DebugConfigProvider } from "./debug_config_provider";

// This provider doesn't implement provideDebugConfigurations so it won't show up in the debug list, however it does support
// resolveDebugConfiguration which gets passed on to the real debugger (which sets its type) so that we can bounce legacy
// debug types over to it.
// This shouldn't really be needed since we're upgrading launch.json, but it's worth having for a few versions.

export class LegacyDebugConfigProvider implements DebugConfigurationProvider {
	private realConfProvider: DebugConfigProvider;
	constructor(realConfProvider: DebugConfigProvider) {
		this.realConfProvider = realConfProvider;
	}

	public resolveDebugConfiguration(folder: WorkspaceFolder | undefined, debugConfig: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
		return this.realConfProvider.resolveDebugConfiguration(folder, debugConfig, token);
	}
}
