
import { strict as assert } from "assert";
import sinon from "sinon";
import * as vs from "vscode";
import { isWin } from "../../../shared/constants";
import { Sdks, WorkspaceConfig } from "../../../shared/interfaces";
import { fsPath } from "../../../shared/utils/fs";
import { DartPackageUriLinkProvider } from "../../../shared/vscode/terminal/package_uri_link_provider";
import { DartPackageUriLink, findFileUriLinks, findPackageUriLinks } from "../../../shared/vscode/terminal_link_provider_utils";
import { WorkspaceContext } from "../../../shared/workspace";
import { activate, helloWorldMainFile, helloWorldMainLibFile, logger, sb } from "../../helpers";

describe("DartFileUriTerminalLinkProvider", () => {
	beforeEach("activate", () => activate());

	it("detects macOS/Linux links without drive letters", async function () {
		if (isWin)
			this.skip();
		await expectLink("file:///foo/bar.dart", "/foo/bar.dart");
		await expectLink("file:///foo/bar.dart:5:8", "/foo/bar.dart", 5, 8);
		await expectLink("file:///foo/bar.dart 5:8", "/foo/bar.dart", 5, 8);
		await expectLink("file:///foo/bar.dart line 5", "/foo/bar.dart", 5);
		await expectLink("aaa file:///foo/bar.dart:5:8 bbb", "/foo/bar.dart", 5, 8);
	});

	it("detects Windows links with drive letters", async function () {
		if (!isWin)
			this.skip();
		await expectLink("file:///C:/foo/bar.dart", "C:\\foo\\bar.dart");
		await expectLink("file:///C:/foo/bar.dart:5:8", "C:\\foo\\bar.dart", 5, 8);
		await expectLink("file:///C:/foo/bar.dart 5:8", "C:\\foo\\bar.dart", 5, 8);
		await expectLink("file:///C:/foo/bar.dart line 5", "C:\\foo\\bar.dart", 5);
		await expectLink("aaa file:///C:/foo/bar.dart:5:8 bbb", "C:\\foo\\bar.dart", 5, 8);
	});

	it("detects Windows links with lowercase drive letters", async function () {
		if (!isWin)
			this.skip();
		await expectLink("file:///c:/foo/bar.dart", "C:\\foo\\bar.dart");
		await expectLink("file:///c:/foo/bar.dart:5:8", "C:\\foo\\bar.dart", 5, 8);
		await expectLink("file:///c:/foo/bar.dart 5:8", "C:\\foo\\bar.dart", 5, 8);
		await expectLink("file:///c:/foo/bar.dart line 5", "C:\\foo\\bar.dart", 5);
		await expectLink("aaa file:///c:/foo/bar.dart:5:8 bbb", "C:\\foo\\bar.dart", 5, 8);
	});

	async function expectLink(lineText: string, filePath: string, line?: number, col?: number) {
		const results = await findFileUriLinks(lineText)
			?? findPackageUriLinks(lineText, (_) => true);
		assert.equal(results.length, 1);
		const result = results[0];
		assert.equal(fsPath(result.uri), filePath);
		assert.equal(result.line, line);
		assert.equal(result.col, col);
	}
});

describe("DartPackageUriTerminalLinkProvider", () => {
	const workspaceContext = new WorkspaceContext({ dartSdkIsFromFlutter: false } as Sdks, {} as WorkspaceConfig, false, false, false, false, undefined);
	const provider = new DartPackageUriLinkProvider(logger, workspaceContext, () => undefined, () => [], 0);
	const file1 = fsPath(helloWorldMainFile);
	const file2 = fsPath(helloWorldMainLibFile);
	const link: DartPackageUriLink = { startIndex: 0, length: 0, tooltip: "", packageName: "foo", uri: "package:foo/main.dart", line: 1, col: 2 };

	it("navigates directly for a single result", () => {
		provider.packageMaps = {
			project1: { resolvePackageUri: () => file1 } as any,
		};
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const jumpToLineCol = executeCommand.withArgs("_dart.jumpToLineColInUri", sinon.match.any, 1, 2).resolves();

		provider.handleTerminalLink(link);

		assert.equal(jumpToLineCol.calledOnce, true);
		const [, uri] = jumpToLineCol.firstCall.args;
		assert.equal(fsPath(uri as vs.Uri), file1);
	});

	it("shows peek when multiple results", () => {
		provider.packageMaps = {
			project1: { resolvePackageUri: () => file1 } as any,
			project2: { resolvePackageUri: () => file2 } as any,
		};
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const goToLocations = executeCommand.withArgs("editor.action.goToLocations", sinon.match.any, sinon.match.any, sinon.match.any, "gotoAndPeek", sinon.match.any).resolves();

		provider.handleTerminalLink(link);

		assert.equal(goToLocations.calledOnce, true);
		const [, uri, position, locations,] = goToLocations.firstCall.args as [unknown, vs.Uri, vs.Position, vs.Location[], unknown];
		assert.equal(fsPath(uri), file1);
		assert.equal(position.line, 1);
		assert.equal(position.character, 2);
		assert.equal(locations.length, 2);
		assert.equal(fsPath(locations[0].uri), file1);
		assert.equal(fsPath(locations[1].uri), file2);
	});
});
