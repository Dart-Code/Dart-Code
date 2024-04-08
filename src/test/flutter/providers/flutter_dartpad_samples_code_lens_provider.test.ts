import { strict as assert } from "assert";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { activate, extApi, getCodeLens, getPackages, openFile, positionOf, sb, waitForResult } from "../../helpers";

describe("test_flutter_dartpad_samples", () => {
	before("get packages", () => getPackages());
	beforeEach("activate", () => activate());

	it("includes interactive sample links for Flutter classes", async function () {
		await verifySampleLink(
			this,
			{
				className: "AppBar",
				expectedUrl: "https://api.flutter.dev/flutter/material/AppBar-class.html#material.AppBar.1",
				libraryName: "material",
				sourceCodeLocation: "class App^Bar extends",
				sourceFilePath: "packages/flutter/lib/src/material/app_bar.dart",
			}
		);
	});

	it("includes interactive sample links for Flutter mixins", async function () {
		await verifySampleLink(
			this,
			{
				className: "RestorationMixin",
				expectedUrl: "https://api.flutter.dev/flutter/widgets/RestorationMixin-mixin.html#widgets.RestorationMixin.1",
				libraryName: "widgets",
				sourceCodeLocation: "mixin Restorat^ionMixin",
				sourceFilePath: "packages/flutter/lib/src/widgets/restoration.dart",
			}
		);
	});

	async function verifySampleLink(test: Mocha.Context, p: TestParams) {
		const sourceFileUri = vs.Uri.file(path.join(extApi.workspaceContext.sdks.flutter!, p.sourceFilePath));
		const editor = await openFile(sourceFileUri);
		await waitForResult(() => !!extApi.fileTracker.getOutlineFor(sourceFileUri));

		const fileCodeLens = await getCodeLens(editor.document);
		const appBarClassPos = positionOf(p.sourceCodeLocation);

		const codeLenses = fileCodeLens.filter((cl) => cl.range.start.line === appBarClassPos.line);
		assert.equal(codeLenses.length, 1);
		const codeLens = codeLenses[0];

		if (!codeLens.command) {
			// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
			// race condition. Rather than failing our test runs, skip.
			// TODO: Remove this if these issues get reliable fixes:
			// - https://github.com/microsoft/vscode/issues/79805
			// - https://github.com/microsoft/vscode/issues/86403
			test.skip();
			return;
		}

		assert.equal(editor.document.getText(codeLens.range).startsWith(p.sourceCodeLocation.replace("^", "")), true);
		assert.equal(codeLens.command.title, `Open online interactive samples for ${p.className}`);
		assert.equal(codeLens.command.command, "_dart.openDartPadSample");
		const sampleInfo = codeLens.command.arguments![0] as { libraryName: string, className: string };
		assert.equal(sampleInfo.libraryName, p.libraryName);
		assert.equal(sampleInfo.className, p.className);

		// Execute the command and ensure it tried to open the correct URL.
		const openBrowserCommand = sb.stub(extApi.envUtils, "openInBrowser").withArgs(sinon.match.any).resolves(true);
		await vs.commands.executeCommand(codeLens.command.command, ...codeLens.command.arguments!); // eslint-disable-line @typescript-eslint/no-unsafe-argument
		assert.ok(openBrowserCommand.calledOnce);
		assert.ok(openBrowserCommand.calledWith(p.expectedUrl));
	}
});

interface TestParams {
	sourceFilePath: string,
	sourceCodeLocation: string,
	className: string,
	libraryName: string,
	expectedUrl: string,
}
