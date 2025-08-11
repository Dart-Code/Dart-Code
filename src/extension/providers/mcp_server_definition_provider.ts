import * as path from "path";
import * as vs from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { dartVMPath } from "../../shared/constants";
import { DartSdks, IAmDisposable } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { config } from "../config";

export class DartMcpServerDefinitionProvider implements vs.McpServerDefinitionProvider, IAmDisposable {
	private readonly disposables: IAmDisposable[] = [];

	private onDidChangeMcpServerDefinitionsEmitter: vs.EventEmitter<void> = new vs.EventEmitter<void>();
	public readonly onDidChangeMcpServerDefinitions: vs.Event<void> = this.onDidChangeMcpServerDefinitionsEmitter.event;

	constructor(private readonly sdks: DartSdks, private readonly dartCapabilities: DartCapabilities) {
		// Inform VS Code the MCP Server list changed if the experiment flag changes.
		this.disposables.push(vs.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("dart.mcpServer") || e.affectsConfiguration("dart.mcpServerLogFile")) {
				this.onDidChangeMcpServerDefinitionsEmitter.fire();
			}
		}));
	}

	public async provideMcpServerDefinitions(_token: vs.CancellationToken): Promise<vs.McpServerDefinition[]> {
		// Dart SDK doesn't support it.
		if (!this.dartCapabilities.supportsMcpServer)
			return [];

		// Not enabled.
		if (!config.mcpServer)
			return [];


		const binPath = path.join(this.sdks.dart, dartVMPath);
		const args = ["mcp-server"];
		if (this.dartCapabilities.mcpServerRequiresExperimentalFlag)
			args.push("--experimental-mcp-server");

		// Add log file flag if configured and supported
		if (config.mcpServerLogFile && this.dartCapabilities.supportsMcpServerLogFile)
			args.push("--log-file", config.mcpServerLogFile);

		return [
			new vs.McpStdioServerDefinition("Dart SDK MCP Server", binPath, args),
		];
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
