import * as vs from "vscode";
import { flutterExtensionIdentifier, noThanksAction } from "../../shared/constants";
import { Context } from "../../shared/vscode/workspace";

import { Analytics, AnalyticsEvent } from "../analytics";
import { promptToReloadExtension } from "../utils";
import { ArbExtensionRecommentation } from "./arb";

export class ExtensionRecommentations {
	private readonly arb: ArbExtensionRecommentation;

	constructor(private readonly analytics: Analytics, private readonly context: Context) {
		this.arb = new ArbExtensionRecommentation(this, context);
	}

	public async promptToInstallFlutterExtension(): Promise<boolean> {
		const installExtension = "Install Flutter Extension";
		const res = await vs.window.showInformationMessage(
			"The Flutter extension is required to work with Flutter projects.",
			installExtension,
		);
		if (res === installExtension) {
			await this.installExtensionWithProgress("Installing Flutter extension", flutterExtensionIdentifier);
			void promptToReloadExtension();
		}

		return false;
	}

	public async promoteExtension(extension: { identifier: string, message: string }) {
		const identifier = extension.identifier;
		const installPackage = `Install ${identifier}`;
		this.analytics.logExtensionPromotion(AnalyticsEvent.ExtensionRecommendation_Shown, identifier);
		const action = await vs.window.showInformationMessage(extension.message, installPackage, noThanksAction);
		if (action === installPackage) {
			this.analytics.logExtensionPromotion(AnalyticsEvent.ExtensionRecommendation_Accepted, identifier);
			await this.installExtensionWithProgress(`Installing ${identifier}`, identifier);
		} else {
			this.analytics.logExtensionPromotion(AnalyticsEvent.ExtensionRecommendation_Rejected, identifier);
			this.context.ignoreExtensionRecommendation(extension.identifier);
		}
	}

	public async installExtensionWithProgress(message: string, extensionIdentifier: string): Promise<void> {
		await vs.window.withProgress({ location: vs.ProgressLocation.Notification },
			(progress) => {
				progress.report({ message });

				return new Promise<void>((resolve) => {
					vs.extensions.onDidChange((e) => resolve());
					void vs.commands.executeCommand("workbench.extensions.installExtension", extensionIdentifier);
				});
			},
		);
	}
}
