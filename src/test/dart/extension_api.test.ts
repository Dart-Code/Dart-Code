import { strict as assert } from "assert";
import { commands, workspace } from "vscode";
import { fsPath } from "../../shared/utils/fs";
import { activate, activateWithoutAnalysis, extApi, helloWorldExampleSubFolder, helloWorldFolder, helloWorldMainFile, waitForResult } from "../helpers";

describe("extension api", () => {
	it("provides the DTD Uri and notifies of changes", async () => {
		await activateWithoutAnalysis();
		await waitForResult(() => !!extApi.dtdUri);

		let didChange = false;
		const sub = extApi.onDtdUriChanged(() => didChange = true);
		await commands.executeCommand("_dart.reloadExtension", "testing");
		await waitForResult(() => didChange);
		sub.dispose();
	});

	it("provides the Dart SDK and notifies of changes", async () => {
		await activateWithoutAnalysis();
		assert.ok(extApi.sdks.dart);

		let didChange = false;
		const sub = extApi.onSdksChanged(() => didChange = true);
		await commands.executeCommand("_dart.reloadExtension", "testing");
		await waitForResult(() => didChange);
		sub.dispose();
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
