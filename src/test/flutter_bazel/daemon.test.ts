import * as fs from "fs";
import { commands } from "vscode";
import { ExtensionRestartReason, isWin } from "../../shared/constants";
import { fsPath } from "../../shared/utils/fs";
import { activate, flutterBazelRoot, prepareHasRunFile, waitForResult } from "../helpers";

describe("flutter daemon", () => {
	beforeEach(function () {
		if (isWin)
			this.skip();
	});

	beforeEach("activate", () => activate());

	it("runs using custom script", async () => {
		const hasRunFile = prepareHasRunFile(fsPath(flutterBazelRoot), "daemon");

		// Restart the extension so the daemon is restarted and will create
		// the hasRun file when it started (since we deleted it in prepareHasRunFile
		// above).
		await commands.executeCommand("_dart.reloadExtension", ExtensionRestartReason.Test);

		await waitForResult(() => fs.existsSync(hasRunFile));
	});
});
