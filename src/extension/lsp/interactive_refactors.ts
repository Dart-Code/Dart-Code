import { CodeAction, CodeActionKind, Command, commands, Uri, window } from "vscode";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";

const commandName = "_dart.interactiveRefactor";

export class InteractiveRefactors implements IAmDisposable {
	private disposables: IAmDisposable[] = [];

	constructor(private readonly logger: Logger) {
		this.disposables.push(commands.registerCommand(commandName, this.handleRefactor, this));
	}

	/// Rewrites any commands in `actions` that are interactive refactors to go through
	/// our own local command that can prompt the user before calling the server.
	public rewriteCommands(actions: Array<Command | CodeAction>) {
		for (const action of actions) {
			if (!("kind" in action))
				continue;

			const command = action.command;
			if (!command || !("command" in command))
				continue;

			if (!action.kind || !CodeActionKind.Refactor.contains(action.kind))
				continue;

			const originalCommandName = command.command;
			const argObject = this.getCommandArgumentObject(command.arguments);
			if (!argObject)
				continue;

			const parameters = this.getCommandParameters(action, argObject);
			if (!parameters)
				continue;

			// TODO(dantup): Is the presence of a "parameters" field (and being a refactor)
			//  enough, or should we have something more specific to be certain this is
			//  what we want ?
			command.command = commandName;
			command.arguments = [originalCommandName, parameters, argObject];
		}
	}

	/// Gets the parameters from the 'data' field of the CodeAction.
	private getCommandParameters(action: CodeAction, argObject: Arguments): Parameter[] | undefined {
		// 'data' is an LSP concept and not exposed in the VS Code type.
		const data = (action as any).data;
		const parameters = data?.parameters;

		// Check the parameters look sensible - a list with a length that matches the original
		// argument set.
		if (Array.isArray(parameters) && parameters.length === argObject.arguments.length)
			return parameters as Parameter[];

		return undefined;
	}

	/// Extract the single arguments object from the command arguments.
	///
	/// For new refactors, command arguments are always a single object in the list
	/// which has named values (like 'file' and 'offset') as well as a well-known
	/// 'arguments' list which is updated by the interaactive parameters.
	private getCommandArgumentObject(args: any[] | undefined): Arguments | undefined {
		if (Array.isArray(args) && args.length === 1 && Array.isArray(args[0].arguments)) {
			return args[0];
		}
	}

	private async handleRefactor(command: string, parameters: Parameter[], originalArguments: Arguments) {
		// {
		// 	"command": {
		// 		"arguments": [
		// 			{
		// 				"filePath": "/Users/danny/Desktop/dart_sample/bin/main.dart",
		// 				"selectionOffset": 104,
		// 				"selectionLength": 0,
		// 				"arguments": [
		// 					"/Users/danny/Desktop/dart_sample/bin/foo.dart"
		// 				]
		// 			}
		// 		],
		// 		"command": "move_top_level_to_file",
		// 		"title": "Move 'Foo' to file"
		// 	},
		// 	"data": {
		// 		"parameters": [
		// 			{
		// 				"defaultValue": "/Users/danny/Desktop/dart_sample/bin/foo.dart",
		// 				"label": "Move to:",
		// 				"type": "filePath"
		// 			}
		// 		]
		// 	},
		// 	"kind": "refactor",
		// 	"title": "Move 'Foo' to file"
		// }

		// Enumerate through each parameter and prompt the user.
		const paramValues = originalArguments.arguments.slice();
		for (let i = 0; i < parameters.length; i++) {
			// TODO(dantup): How are parameters we
			const newValue = await this.promptUser(parameters[i]);

			// If no value, user cancelled so we should abort.
			if (!newValue)
				return;

			paramValues[i] = newValue;
		}

		// Do nothing yet.
		return commands.executeCommand(command, { ...originalArguments, arguments: paramValues });
	}

	private async promptUser(parameter: Parameter): Promise<string | undefined> {
		switch (parameter.type) {
			case "filePath":
				return this.promptUserFilePath(parameter);
			default:
				this.logger.warn(`Unknown parameter type ${parameter.type}. Using default value (${parameter.defaultValue})`);
				return parameter.defaultValue;
		}
	}

	private async promptUserFilePath(parameter: Parameter): Promise<string | undefined> {
		const uri = await window.showSaveDialog({
			defaultUri: Uri.file(parameter.defaultValue),
			// TODO(dantup): Should we have an option for this?
			filters: { "Dart Files": ["dart"] },
			// TODO(dantup): Should we take this from the server?
			saveLabel: "Move",
			title: parameter.label,
		});
		return uri ? fsPath(uri) : undefined;
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

interface Arguments {
	arguments: string[];
}

interface Parameter {
	// Ensure these match the Dart definition (and are only modified in compatible ways
	// once the feature is not behind a flag).
	// See 'CommandParameter' in
	// https://github.com/dart-lang/sdk/blob/main/pkg/analysis_server/tool/lsp_spec/generate_all.dart
	defaultValue: string;
	label: string;
	type: ParameterType;
}

// Ensure these match the Dart definition (and are only modified in compatible ways
// once the feature is not behind a flag).
// See 'CommandParameterType' in
// https://github.com/dart-lang/sdk/blob/main/pkg/analysis_server/tool/lsp_spec/generate_all.dart
type ParameterType = "boolean" | "string" | "filePath" | unknown;
