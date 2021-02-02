import * as vs from "vscode";
import { Logger } from "../shared/interfaces";
import { getRandomInt } from "../shared/utils/fs";
import { Context } from "../shared/vscode/workspace";
import { WorkspaceContext } from "../shared/workspace";
import { config } from "./config";

// Used for testing. DO NOT COMMIT AS TRUE.
const clearAllExperiments = false;

export interface KnownExperiments { lspPrompt: LspExperiment }
export function getExperiments(logger: Logger, workspaceContext: WorkspaceContext, context: Context) {
	return {
		lspPrompt: new LspExperiment(logger, workspaceContext, context),
	};
}

class Experiment {
	private readonly randomNumber: number;
	constructor(protected readonly logger: Logger, protected readonly workspaceContext: WorkspaceContext, private readonly context: Context, private readonly id: string, private readonly currentPercent: number) {
		// If this is the first time we've seen this experiment, generate a random number
		// from 1-100.
		const contextKey = `experiement-${id}`;
		const contextHasActivatedKey = `${contextKey}-hasActivated`;
		if (clearAllExperiments) {
			context.update(contextKey, undefined);
			context.update(contextHasActivatedKey, undefined);
		}

		this.randomNumber = context.get(contextKey);
		if (!this.randomNumber) {
			this.randomNumber = getRandomInt(1, 100);
			context.update(contextKey, this.randomNumber);
			logger.info(`Generated random number ${this.randomNumber} for new experiement '${id}'. Experiment is enabled for <= ${this.currentPercent}`);
		} else {
			logger.info(`Experiment random number is ${this.randomNumber} for experiement '${id}'. Experiment is enabled for <= ${this.currentPercent}`);
		}

		if (this.applies) {
			const isFirst = !context.get(contextHasActivatedKey);
			context.update(contextHasActivatedKey, true);
			logger.info(`Experiment '${id}' is activating (${isFirst ? "first time" : "not first time"})`);
			this.activate(isFirst)
				// Activate is allowed to return false if it skipped activating (eg. not relevant) so
				// first activation can re-run in future.
				.then((v) => {
					if (v === false) {
						logger.info(`Experiment '${id}' aborted. Clearing hasActivated flag`);
						context.update(contextHasActivatedKey, undefined);
					}
				});
		}
	}

	get applies(): boolean { return this.randomNumber <= this.currentPercent; }

	/// Activates the experiment. If returns false, resets the hasActivated flag so it
	/// is not considered to have run.
	protected async activate(isFirstActivation: boolean): Promise<undefined | false> { return; }
}

class LspExperiment extends Experiment {
	constructor(logger: Logger, workspaceContext: WorkspaceContext, context: Context) {
		super(logger, workspaceContext, context, "lsp-prompt", 60);
	}

	protected async activate(isFirstActivation: boolean): Promise<undefined | false> {
		// If we don't have any projects, skip this and return false so we can re-trigger in future.
		if (!this.workspaceContext.hasAnyStandardDartProjects && !this.workspaceContext.hasAnyFlutterProjects)
			return false;

		// Never prompt if LSP is already enabled or this isn't the first activation.
		if (config.previewLsp || !isFirstActivation)
			return;

		const yesPleaseAction = "Yes please!";
		const noThanksAction = "No thanks";
		const action = await vs.window.showInformationMessage("Dart-Code is switching to using the Language Server Protocol for improved performance. Would you like to enable the preview now?", yesPleaseAction, noThanksAction);

		if (action === yesPleaseAction) {
			this.logger.info("Enabling LSP preview and reloading!");
			await config.setPreviewLsp(true);
			vs.commands.executeCommand("workbench.action.reloadWindow");
		}
	}
}
