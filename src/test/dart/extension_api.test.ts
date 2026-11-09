import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import { commands, workspace } from "vscode";
import * as ls from "vscode-languageclient";
import { ExtensionRestartReason } from "../../shared/constants";
import { fsPath } from "../../shared/utils/fs";
import { activate, activateWithoutAnalysis, defer, delay, extApi, getRandomTempFolder, helloWorldExampleSubFolder, helloWorldFolder, helloWorldMainFile, privateApi, sb, setConfigForTest, tryDelete, waitForResult } from "../helpers";

describe("extension api", () => {
	it("provides the DTD Uri and notifies of changes", async () => {
		await activateWithoutAnalysis();
		await waitForResult(() => !!extApi.dtdUri);

		let didChange = false;
		const sub = extApi.onDtdUriChanged(() => didChange = true);
		await commands.executeCommand("_dart.reloadExtension", ExtensionRestartReason.Test);
		await waitForResult(() => didChange);
		sub.dispose();
	});

	it("provides the Dart SDK and notifies of changes", async () => {
		await activateWithoutAnalysis();
		assert.ok(extApi.sdks.dart);

		let didChange = false;
		const sub = extApi.onSdksChanged(() => didChange = true);
		await commands.executeCommand("_dart.reloadExtension", ExtensionRestartReason.Test);
		await waitForResult(() => didChange);
		sub.dispose();
	});

	it("coalesces overlapping extension reloads without breaking the analyzer", async () => {
		await activateWithoutAnalysis();
		const initialAnalyzer = privateApi.analyzer;
		const warnSpy = sb.spy(privateApi.logger, "warn");

		// Trigger two concurrent reloads; the second arrives while the first is still
		// deactivating and should coalesce into the first reload rather than spawning
		// a second deactivate/activate cycle.
		await Promise.all([
			commands.executeCommand("_dart.reloadExtension", ExtensionRestartReason.Test),
			commands.executeCommand("_dart.reloadExtension", ExtensionRestartReason.Test),
		]);

		// The overlapping reload requests should have coalesced into a single reload,
		// disposed the original analyzer, and replaced it with a new live analyzer.
		const firstReloadAnalyzer = privateApi.analyzer;
		assert.equal(warnSpy.withArgs(sinon.match("Performing extension reload")).callCount, 1);
		assert.equal(initialAnalyzer.isDisposed, true);
		assert.notStrictEqual(firstReloadAnalyzer, initialAnalyzer);
		assert.equal(firstReloadAnalyzer.isDisposed, false);

		// Immediately trigger another reload while `firstReloadAnalyzer`'s LanguageClient
		// is still starting up in the background (before `initialAnalysis` completes),
		// verifying that disposing an in-flight analyzer waits for `clientStartPromise` to
		// settle and stops it cleanly without colliding with the next analyzer's registrations.
		assert.equal(firstReloadAnalyzer.client.state, ls.State.Starting);
		await commands.executeCommand("_dart.reloadExtension", ExtensionRestartReason.Test);
		assert.equal(firstReloadAnalyzer.isDisposed, true);
		assert.equal(firstReloadAnalyzer.client.state, ls.State.Stopped);
		assert.deepEqual(
			firstReloadAnalyzer.client.clientOptions.errorHandler!.closed(),
			{ action: ls.CloseAction.DoNotRestart, handled: true },
		);
		assert.notStrictEqual(privateApi.analyzer, firstReloadAnalyzer);
		assert.equal(privateApi.analyzer.isDisposed, false);

		// Wait for initial/current analysis on the newly reloaded analyzer and verify
		// that it is functional and serving LSP requests (such as document outlines)
		// rather than hanging due to failed client initialization.
		await activate();
		const doc = await workspace.openTextDocument(helloWorldMainFile);
		const outline = (await extApi.workspace.getOutline(doc))!;
		assert.equal(outline.element.name, "<unit>");
	});

	it("debounces configuration changes and ignores changes reverted before debounce expires", async () => {
		await activateWithoutAnalysis();

		const executeCommandStub = sb.stub(commands, "executeCommand").callThrough();
		const reloadStub = executeCommandStub.withArgs("_dart.reloadExtension", sinon.match.any, sinon.match.any).resolves();

		sb.stub(privateApi.config, "configChangeDebounceDelayMs").get(() => 150);

		// Change a restart-requiring setting and revert it before the 150ms debounce expires.
		const origClosingLabels = workspace.getConfiguration("dart").get<boolean>("closingLabels");
		await setConfigForTest("dart", "closingLabels", !origClosingLabels);
		await setConfigForTest("dart", "closingLabels", origClosingLabels);
		await delay(250);
		assert.equal(reloadStub.callCount, 0);

		// Now make multiple rapid changes to restart-requiring settings within the debounce window
		// and verify only a single reload is triggered after the debounce settles.
		const tempFolder = getRandomTempFolder();
		defer("delete temp folder", () => tryDelete(tempFolder));
		await setConfigForTest("dart", "analyzerLogFile", path.join(tempFolder, "analyzer1.log"));
		await setConfigForTest("dart", "analyzerLogFile", path.join(tempFolder, "analyzer2.log"));
		await setConfigForTest("dart", "devToolsLogFile", path.join(tempFolder, "devtools.log"));

		await waitForResult(() => reloadStub.callCount === 1);
		assert.ok(reloadStub.calledOnceWithExactly(
			"_dart.reloadExtension",
			ExtensionRestartReason.ConfigurationChange,
			"analyzerLogFile,devToolsLogFile",
		));

		// Reset back to undefined and wait for the debounced config handler to settle while stubbed.
		await setConfigForTest("dart", "analyzerLogFile", undefined);
		await setConfigForTest("dart", "devToolsLogFile", undefined);
		await waitForResult(() => reloadStub.callCount === 2);
	});

	it("switches extensionLogFile and creates startup log files on configuration reload", async () => {
		await activateWithoutAnalysis();

		const tempFolder = getRandomTempFolder();
		defer("delete temp folder", () => tryDelete(tempFolder));
		const extLogPath = path.join(tempFolder, "extension.log");
		const analyzerLogPath = path.join(tempFolder, "analyzer.log");

		sb.stub(privateApi.config, "configChangeDebounceDelayMs").get(() => 100);
		await setConfigForTest("dart", "extensionLogFile", extLogPath);
		await setConfigForTest("dart", "analyzerLogFile", analyzerLogPath);

		await waitForResult(() => fs.existsSync(extLogPath) && fs.existsSync(analyzerLogPath));
		privateApi.logger.info("Test general log message after reload");
		await waitForResult(() => fs.readFileSync(extLogPath, "utf8").includes("Test general log message after reload"));

		// Restore settings and wait for the reload back to defaults to complete before finishing the test.
		const initialAnalyzer = privateApi.analyzer;
		await setConfigForTest("dart", "extensionLogFile", undefined);
		await setConfigForTest("dart", "analyzerLogFile", undefined);
		await waitForResult(() => privateApi.analyzer !== initialAnalyzer && !privateApi.analyzer.isDisposed);
	});

	it("workspace.getOutline", async () => {
		await activate();

		const doc = await workspace.openTextDocument(helloWorldMainFile);
		const outline = (await extApi.workspace.getOutline(doc))!;

		assert.equal(outline.element.name, "<unit>");
		assert.equal(outline.element.kind, "COMPILATION_UNIT");
		assert.ok(outline.range);
		assert.ok(outline.codeRange);

		const main = outline.children![0];
		assert.equal(main.element.name, "main");
		assert.equal(main.element.kind, "FUNCTION");
		assert.ok(main.range);
		assert.ok(main.codeRange);
	});

	it("workspace.findProjectFolders", async () => {
		await activate();

		const projects = await extApi.workspace.findProjectFolders();
		assert.deepStrictEqual(projects, [fsPath(helloWorldFolder), fsPath(helloWorldExampleSubFolder)]);
	});

	it("sdk.runDart with --help", async () => {
		await activate();

		const result = (await extApi.sdk.runDart(fsPath(helloWorldFolder), ["--help"]))!;
		assert.equal(result.exitCode, 0);
		assert.ok(result.stdout.includes("A command-line utility for Dart development"));
	});

	it("sdk.runPub with --help", async () => {
		await activate();

		const result = (await extApi.sdk.runPub(fsPath(helloWorldFolder), ["--help"]))!;
		assert.equal(result.exitCode, 0);
		assert.ok(result.stdout.includes("Work with packages."));
	});

	it("sdk.startDart with --help", async () => {
		await activate();

		const proc = (await extApi.sdk.startDart(fsPath(helloWorldFolder), ["--help"]))!;

		const stdout = await new Promise<string>((resolve) => {
			const stdoutChunks: string[] = [];
			proc.stdout?.on("data", (data: string) => stdoutChunks.push(data));
			proc.on("close", () => resolve(stdoutChunks.join("")));
		});

		assert.ok(stdout.includes("A command-line utility for Dart development"));
	});
});
