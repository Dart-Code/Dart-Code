import * as assert from "assert";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { activate, extApi, getCodeLens, getPackages, openFile, positionOf, sb, waitForResult } from "../../helpers";

describe("test_flutter_dartpad_samples", () => {
	before("get packages", () => getPackages());
	beforeEach("activate", () => activate());

	it("includes interactive sample links for Flutter widgets", async function () {
		const appBarUri = vs.Uri.file(path.join(extApi.workspaceContext.sdks.flutter!, "packages/flutter/lib/src/material/app_bar.dart"));
		const editor = await openFile(appBarUri);
		await waitForResult(() => !!extApi.fileTracker.getOutlineFor(appBarUri));

		const fileCodeLens = await getCodeLens(editor.document);
		const appBarClassPos = positionOf(`class App^Bar`);

		const codeLenses = fileCodeLens.filter((cl) => cl.range.start.line === appBarClassPos.line);
		assert.equal(codeLenses.length, 1);
		const codeLens = codeLenses[0];

		if (!codeLens.command) {
			// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
			// race condition. Rather than failing our test runs, skip.
			// TODO: Remove this if these issues get reliable fixes:
			// - https://github.com/microsoft/vscode/issues/79805
			// - https://github.com/microsoft/vscode/issues/86403
			this.skip();
			return;
		}

		assert.equal(editor.document.getText(codeLens.range).startsWith("class AppBar extends StatefulWidget"), true);
		assert.equal(codeLens.command!.title, "Open online interactive samples for AppBar");
		assert.equal(codeLens.command!.command, "_dart.openDartPadSample");
		const sampleInfo = codeLens.command!.arguments![0] as { libraryName: string, className: string };
		assert.equal(sampleInfo.libraryName, "material");
		assert.equal(sampleInfo.className, "AppBar");

		// Execute the command and ensure it tried to open the correct URL.
		const openBrowserCommand = sb.stub(extApi.envUtils, "openInBrowser").withArgs(sinon.match.any).resolves(true);
		vs.commands.executeCommand(codeLens.command.command, ...codeLens.command.arguments!);
		assert.ok(openBrowserCommand.calledOnce);
		assert.ok(openBrowserCommand.calledWith("https://api.flutter.dev/flutter/material/AppBar-class.html#material.AppBar.1"));
	});
});
