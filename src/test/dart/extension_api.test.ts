import { strict as assert } from "assert";
import * as sinon from "sinon";
import { commands, workspace } from "vscode";
import { ExtensionRestartReason } from "../../shared/constants";
import { fsPath } from "../../shared/utils/fs";
import { activate, activateWithoutAnalysis, extApi, helloWorldExampleSubFolder, helloWorldFolder, helloWorldMainFile, privateApi, sb, waitForResult } from "../helpers";

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
		assert.equal((initialAnalyzer as any).isDisposed, true);
		assert.notStrictEqual(firstReloadAnalyzer, initialAnalyzer);
		assert.equal((firstReloadAnalyzer as any).isDisposed, false);

		// Immediately trigger another reload while `firstReloadAnalyzer`'s LanguageClient
		// is still starting up in the background (before `initialAnalysis` completes),
		// verifying that disposing an in-flight analyzer waits for `client.start()` to
		// settle and stops it cleanly without colliding with the next analyzer's registrations.
		await commands.executeCommand("_dart.reloadExtension", ExtensionRestartReason.Test);
		assert.equal((firstReloadAnalyzer as any).isDisposed, true);
		assert.notStrictEqual(privateApi.analyzer, firstReloadAnalyzer);
		assert.equal((privateApi.analyzer as any).isDisposed, false);

		// Wait for initial/current analysis on the newly reloaded analyzer and verify
		// that it is functional and serving LSP requests (such as document outlines)
		// rather than hanging due to failed client initialization.
		await activate();
		const doc = await workspace.openTextDocument(helloWorldMainFile);
		const outline = (await extApi.workspace.getOutline(doc))!;
		assert.equal(outline.element.name, "<unit>");
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
