import * as vs from "vscode";
import { ClientCapabilities, ExecuteCommandSignature, FeatureState, StaticFeature } from "vscode-languageclient";
import { LanguageClient } from "vscode-languageclient/node";
import { validClassNameRegex, validMethodNameRegex } from "../../../shared/constants";
import { Logger } from "../../../shared/interfaces";

interface LegacyRefactorCommandArgs {
	kind?: unknown;
	options?: unknown;
	path: unknown;
}

interface LegacyRefactorValidateResult {
	message?: string;
	valid: boolean;
}

export class LegacyRefactors {
	constructor(private readonly logger: Logger, client: LanguageClient) {
		this.addMiddleware(client);
	}

	public get feature(): StaticFeature {
		return {
			clear() { },
			fillClientCapabilities(_capabilities: ClientCapabilities) { },
			getState(): FeatureState {
				return { kind: "static" };
			},
			initialize() { },
		};
	}

	private addMiddleware(client: LanguageClient) {
		const middleware = client.clientOptions.middleware ??= {};
		const previousExecuteCommand = middleware.executeCommand;
		middleware.executeCommand = async (command, args, next) => {
			const executeCommand: ExecuteCommandSignature = async (nextCommand, nextArgs) => {
				if (previousExecuteCommand)
					return await previousExecuteCommand(nextCommand, nextArgs, next) as unknown;

				return await next(nextCommand, nextArgs) as unknown;
			};

			return this.executeCommand(command, args, executeCommand);
		};
	}

	private async executeCommand(command: string, args: unknown[], next: ExecuteCommandSignature): Promise<unknown> {
		const validateCommand = command === "refactor.perform"
			? "refactor.validate"
			: command === "dart.refactor.perform"
				? "dart.refactor.validate"
				: undefined;

		if (validateCommand) {
			const mapArgs = args[0] as LegacyRefactorCommandArgs | undefined;
			const listArgsKindIndex = 0;
			const listArgsOptionsIndex = 5;
			const isValidListArgs = args.length === 6;
			const isValidMapsArgs = args.length === 1 && mapArgs?.path !== undefined;
			if (isValidListArgs || isValidMapsArgs) {
				const refactorFailedErrorCode = -32011;
				const refactorKind = isValidListArgs ? args[listArgsKindIndex] : mapArgs?.kind;
				const shouldPromptForName = refactorKind === "EXTRACT_METHOD" || refactorKind === "EXTRACT_WIDGET";
				if (shouldPromptForName) {
					// Validate first, because if there is a reason the refactor will fail, we don't want to prompt
					// for the name first and then fail for an unrelated reason.
					try {
						const validateResult = (await next(validateCommand, args)) as LegacyRefactorValidateResult;
						if (validateResult.valid === false) {
							void vs.window.showErrorMessage(validateResult.message ?? "Refactor validation failed");
							return;
						}
					} catch (e) {
						this.logger.error(e);
					}

					const name = await this.promptForName(refactorKind);
					if (!name)
						return;

					if (isValidListArgs)
						args[listArgsOptionsIndex] = Object.assign({}, args[listArgsOptionsIndex], { name });
					else if (mapArgs)
						mapArgs.options = Object.assign({}, mapArgs.options, { name });
				}

				try {
					return await next(command, args);
				} catch (e: any) {
					if (e?.code === refactorFailedErrorCode) {
						void vs.window.showErrorMessage(e.message as string);
						return;
					} else {
						throw e;
					}
				}
			}
		}

		return next(command, args);
	}

	private promptForName(refactorKind: string): Thenable<string | undefined> | undefined {
		switch (refactorKind) {
			case "EXTRACT_METHOD":
				return vs.window.showInputBox({
					prompt: "Enter a name for the method",
					validateInput: (s) => validMethodNameRegex.test(s) ? undefined : "Enter a valid method name",
					value: "newMethod",
				});

			case "EXTRACT_WIDGET":
				return vs.window.showInputBox({
					prompt: "Enter a name for the widget",
					validateInput: (s) => validClassNameRegex.test(s) ? undefined : "Enter a valid widget name",
					value: "NewWidget",
				});

			default:
				return undefined;
		}
	}
}
