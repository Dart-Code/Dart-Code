import * as vs from "vscode";
import { ExtensionRestartReason, flutterExtensionIdentifier, noThanksAction } from "../../shared/constants";
import { Context } from "../../shared/vscode/workspace";

import { Logger } from "../../shared/interfaces";
import { Analytics, AnalyticsEvent } from "../analytics";
import { promptToReloadExtension } from "../utils";
import { ArbExtensionRecommentation } from "./arb";

export class ExtensionRecommentations {
	private readonly arb: ArbExtensionRecommentation;

	constructor(private readonly logger: Logger, private readonly analytics: Analytics, private readonly context: Context) {
		this.arb = new ArbExtensionRecommentation(this, context);
	}

	public async promptToInstallFlutterExtension(): Promise<boolean> {
		const installExtension = "Install Flutter Extension";
		const res = await vs.window.showInformationMessage(
			"The Flutter extension is required to work with Flutter projects.",
			installExtension,
		);
		if (res === installExtension) {
			await this.installExtension(flutterExtensionIdentifier);
			void promptToReloadExtension(this.logger, { restartReason: ExtensionRestartReason.AfterFlutterExtensionInstall });
		}

		return false;
	}

	public async promoteExtension(extension: { identifier: string, message: string }) {
		const identifier = extension.identifier;

		// Never promote ignored extensions.
		const ignoredExtensions = this.context.getIgnoredExtensionRecommendationIdentifiers();
		if (ignoredExtensions.find((ignored) => ignored.trim().toLowerCase() === identifier.trim().toLowerCase()))
			return;

		// Never promote already-installed extensions.
		if (vs.extensions.getExtension(identifier.trim()))
			return;

		const installPackage = `Install/Enable ${identifier}`;
		this.analytics.logExtensionPromotion(AnalyticsEvent.ExtensionRecommendation_Shown, identifier);
		const action = await vs.window.showInformationMessage(extension.message, installPackage, noThanksAction);
		if (action === installPackage) {
			this.analytics.logExtensionPromotion(AnalyticsEvent.ExtensionRecommendation_Accepted, identifier);
			await this.installExtension(identifier);
		} else {
			this.analytics.logExtensionPromotion(AnalyticsEvent.ExtensionRecommendation_Rejected, identifier);
			this.context.ignoreExtensionRecommendation(extension.identifier);
		}
	}

	public async installExtension(identifier: string): Promise<void> {
		await vs.commands.executeCommand("workbench.extensions.installExtension", identifier, { enable: true });
	}
}
