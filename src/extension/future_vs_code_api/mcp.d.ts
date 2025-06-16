// MCP definitions were only finalized in VS Code 1.101 but to keep compatibility with other editors that lag behind
// (such as Firebase Studio), we haven't bumped the minimum version in package.json. So instead, we provide definitions
// for the MCP parts here so we can use them if they exist while still being compatible with other editors.
//
// https://github.com/microsoft/vscode/pull/248244/files

declare module "vscode" {
	export class McpStdioServerDefinition {
		readonly label: string;
		cwd?: Uri;
		command: string;
		args: string[];
		env: Record<string, string | number | null>;
		version?: string;

		constructor(label: string, command: string, args?: string[], env?: Record<string, string | number | null>, version?: string);
	}

	export type McpServerDefinition = McpStdioServerDefinition;

	export interface McpServerDefinitionProvider<T extends McpServerDefinition = McpServerDefinition> {
		readonly onDidChangeMcpServerDefinitions?: Event<void>;
		provideMcpServerDefinitions(token: CancellationToken): ProviderResult<T[]>;
		resolveMcpServerDefinition?(server: T, token: CancellationToken): ProviderResult<T>;
	}

	export namespace lm {
		// We define this with `| undefined` because that's what it will be for
		// older versions of VS Code. We want to force testing for it before trying to
		// call it so that we don't throw in older VS Code versions.
		export const registerMcpServerDefinitionProvider: ((id: string, provider: McpServerDefinitionProvider) => Disposable) | undefined;
	}

}
