import { CodeAction, CodeActionKind, Command, commands, Uri, window } from "vscode";
import { ClientCapabilities, FeatureState, StaticFeature } from "vscode-languageclient";
import { DartCapabilities } from "../capabilities/dart";
import { IAmDisposable, Logger } from "../interfaces";
import { disposeAll } from "../utils";


export class InteractiveRefactors implements IAmDisposable {
	static readonly commandName = "_dart.interactiveRefactor";

	private disposables: IAmDisposable[] = [];

	constructor(private readonly logger: Logger, private readonly dartCapabilities: DartCapabilities) {
		this.disposables.push(commands.registerCommand(InteractiveRefactors.commandName, this.handleRefactor, this));
	}

	public get feature(): StaticFeature {
		const dartCapabilities = this.dartCapabilities;
		return {
			dispose() { },
			fillClientCapabilities(capabilities: ClientCapabilities) {
				capabilities.experimental = capabilities.experimental ?? {};
				capabilities.experimental.dartCodeAction = capabilities.experimental.dartCodeAction ?? {};
				// Originally server expected a `bool` for `commandParameterSupport` so we can only send
				// this object to new versions.
				if (dartCapabilities.supportsCommandParameterSupportedKinds) {
					capabilities.experimental.dartCodeAction.commandParameterSupport = {
						"supportedKinds": Object.values(SupportedParameterKind),
					};
				}
			},
			getState(): FeatureState {
				return { kind: "static" };
			},
			initialize() { },
		};
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
			command.command = InteractiveRefactors.commandName;
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
	/// 'arguments' list which is updated by the interactive parameters.
	private getCommandArgumentObject(args: any[] | undefined): Arguments | undefined {
		if (Array.isArray(args) && args.length === 1 && Array.isArray(args[0].arguments)) {
			return args[0];
		}
	}

	private async handleRefactor(command: string, parameters: Parameter[], originalArguments: Arguments) {
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

	/// Prompts the user for a value for `parameter`.
	///
	/// If the user cancels, returns `undefined`.
	///
	/// If the type of `parameter` is not supported, its default value.
	private async promptUser(parameter: Parameter): Promise<unknown | undefined> {
		if (SaveUriParameter.is(parameter)) {
			return (await this.promptUserSaveUri(parameter))?.toString();
		} else {
			this.logger.warn(`Unknown parameter kind ${parameter.kind}. Using default value (${parameter.defaultValue})`);
			return parameter.defaultValue;
		}
	}

	private async promptUserSaveUri(parameter: SaveUriParameter): Promise<Uri | undefined> {
		const uri = await window.showSaveDialog({
			defaultUri: parameter.defaultValue ? Uri.parse(parameter.defaultValue) : undefined,
			filters: parameter.filters,
			saveLabel: parameter.actionLabel,
			title: parameter.parameterTitle,
		});
		return uri;
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

interface Arguments {
	arguments: unknown[];
}

export enum SupportedParameterKind {
	saveUri = "saveUri",
}

interface Parameter {
	kind: string;
	parameterLabel: string;
	defaultValue?: unknown;
}

interface SaveUriParameter extends Parameter {
	defaultValue?: string | null | undefined;
	parameterTitle: string;
	actionLabel: string;
	kind: SupportedParameterKind.saveUri;
	filters?: { [key: string]: string[] };
}

namespace SaveUriParameter {
	export function is(parameter: Parameter): parameter is SaveUriParameter {
		return parameter.kind === SupportedParameterKind.saveUri;
	}
}

