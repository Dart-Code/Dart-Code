import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../shared/utils/fs";
import { Context } from "../../shared/vscode/workspace";
import { ExtensionRecommentations } from "./recommendations";

const arbExtensionIdentifier = "Google.arb-editor";

export class ArbExtensionRecommentation {
	constructor(private readonly recommendations: ExtensionRecommentations, private readonly context: Context) {
		context.context.subscriptions.push(vs.window.onDidChangeActiveTextEditor((e) => this.maybePrompt(e?.document)));
	}

	private hasShownPromptThisSession = false;

	private async maybePrompt(doc: vs.TextDocument | undefined): Promise<void> {
		if (!doc)
			return;

		if (this.hasShownPromptThisSession)
			return;

		// Not an ARB file. We can't check the languageId for JSON here, because the extension is not
		// matched to the JSON language until the ARB extension is installed.
		if (path.extname(fsPath(doc.uri)) !== ".arb")
			return;

		// Have already ignored.
		if (this.context.getIgnoredExtensionRecommendationIdentifiers().find((identifier) => identifier.toLowerCase() === arbExtensionIdentifier.toLowerCase()))
			return;

		this.hasShownPromptThisSession = true;
		await this.recommendations.promoteExtension({
			identifier: arbExtensionIdentifier,
			message: "The Google ARB Editor extension can provide validation and completion for ARB files.",
		});

	}
}
