import { strict as assert } from "assert";
import * as sinon from "sinon";
import * as vs from "vscode";
import { noThanksAction } from "../../../shared/constants";
import { activate, extApi, sb } from "../../helpers";

describe("devtools extensions recommendations", () => {
	beforeEach("activate", () => activate());

	beforeEach("skip if not supported", async function () {
		if (!extApi.dartCapabilities.supportsDevToolsVsCodeExtensions)
			this.skip();

		await extApi.context.context.globalState.update(`ignoredExtensionRecommendations`, undefined);
	});

	it("prompts and installs", async () => {
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const installExtension = executeCommand.withArgs("workbench.extensions.installExtension", sinon.match.any).resolves();

		const installExtensionPrompt = sb.stub(vs.window, "showInformationMessage")
			.withArgs("A third-party extension is available for package:my_package", sinon.match.any, sinon.match.any)
			.resolves("Install/Enable ms-vscode.hexeditor");

		await extApi.devTools.start();
		await extApi.devTools.promptForExtensionRecommendations();

		// Ensure we were prompted.
		assert.equal(installExtensionPrompt.calledOnce, true);
		// Ensure we tried to install the extension.
		assert.equal(installExtension.calledOnce, true);
	});

	it("prompts and does not install", async () => {
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const installExtension = executeCommand.withArgs("workbench.extensions.installExtension", sinon.match.any).resolves();

		const installExtensionPrompt = sb.stub(vs.window, "showInformationMessage")
			.withArgs("A third-party extension is available for package:my_package", sinon.match.any, sinon.match.any)
			.resolves(noThanksAction);

		await extApi.devTools.start();
		await extApi.devTools.promptForExtensionRecommendations();

		// Ensure we were prompted.
		assert.equal(installExtensionPrompt.calledOnce, true);
		// Ensure we did not try to install the extension.
		assert.equal(installExtension.called, false);
	});
});
