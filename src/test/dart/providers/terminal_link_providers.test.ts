
import { strict as assert } from "assert";
import sinon from "sinon";
import * as vs from "vscode";
import { isWin } from "../../../shared/constants";
import { Sdks, WorkspaceConfig } from "../../../shared/interfaces";
import { PackageMap } from "../../../shared/pub/package_map";
import { fsPath } from "../../../shared/utils/fs";
import { DartPackageUriLinkProvider } from "../../../shared/vscode/terminal/package_uri_link_provider";
import { DartPackageUriLink, findFileUriLinks, findPackageUriLinks } from "../../../shared/vscode/terminal_link_provider_utils";
import { WorkspaceContext } from "../../../shared/workspace";
import { activate, currentDoc, emptyFile, fakeCancellationToken, helloWorldExampleSubFolder, helloWorldFolder, helloWorldMainFile, helloWorldMainLibFile, helloWorldPubspec, logger, openFile, rangeOf, sb, setTestContent } from "../../helpers";

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
	beforeEach("activate", () => activate());

	let bestProjectRoot: string | undefined;
	const workspaceContext = new WorkspaceContext({ dartSdkIsFromFlutter: false } as Sdks, {} satisfies WorkspaceConfig, false, false, false, false, undefined, undefined);
	const provider = new DartPackageUriLinkProvider(logger, workspaceContext, () => bestProjectRoot, () => [], 2);
	const file1 = fsPath(helloWorldMainFile);
	const file2 = fsPath(helloWorldMainLibFile);
	const link: DartPackageUriLink = { startIndex: 0, length: 0, tooltip: "", packageName: "foo", uri: "package:foo/main.dart", line: 1, col: 2 };

	function fakePackageMap(packages: Record<string, string>, resolvePackageUri: (uri: string) => string | undefined): PackageMap {
		return { packages, resolvePackageUri } as unknown as PackageMap;
	}

	function terminalLinkContext(line: string): vs.TerminalLinkContext {
		return { line, terminal: undefined as unknown as vs.Terminal };
	}

	beforeEach("reset provider state", () => {
		bestProjectRoot = undefined;
		provider.packageMaps = undefined;
		provider.packageMapDiscovery = undefined;
	});

	it("discovers package maps, reuses in-flight discovery, filters to known packages, and invalidates on package map change", async () => {
		const loadForProject = sb.stub(PackageMap, "loadForProject").callsFake((_logger, projectFolder) => {
			if (projectFolder === fsPath(helloWorldFolder))
				return fakePackageMap({ foo: fsPath(helloWorldFolder) }, () => file1);
			return fakePackageMap({}, () => undefined);
		});
		const helloWorldLoadCalls = () => loadForProject.withArgs(sinon.match.any, fsPath(helloWorldFolder)).callCount;

		// Trigger two concurrent calls while packageMaps is uninitialized; both should share the in-flight discovery promise.
		const promise1 = provider.provideTerminalLinks(terminalLinkContext("package:foo/main.dart:1:2 and package:unknown/main.dart:3:4"), fakeCancellationToken);
		const firstDiscoveryPromise = provider.packageMapDiscovery;
		assert.ok(firstDiscoveryPromise);

		const promise2 = provider.provideTerminalLinks(terminalLinkContext("package:foo/other.dart:5:6"), fakeCancellationToken);
		assert.strictEqual(provider.packageMapDiscovery, firstDiscoveryPromise);

		const [links1, links2] = await Promise.all([promise1, promise2]);
		assert.equal(helloWorldLoadCalls(), 1);

		assert.equal(links1.length, 1);
		assert.equal(links1[0].packageName, "foo");
		assert.equal(links1[0].uri, "package:foo/main.dart");
		assert.equal(links1[0].line, 1);
		assert.equal(links1[0].col, 2);

		assert.equal(links2.length, 1);
		assert.equal(links2[0].packageName, "foo");
		assert.equal(links2[0].uri, "package:foo/other.dart");
		assert.equal(links2[0].line, 5);
		assert.equal(links2[0].col, 6);

		// Subsequent call uses cached packageMaps without re-running discovery.
		await provider.provideTerminalLinks(terminalLinkContext("package:foo/main.dart"), fakeCancellationToken);
		assert.equal(helloWorldLoadCalls(), 1);

		// Firing onPackageMapChange clears the cache so the next call re-discovers package maps.
		workspaceContext.events.onPackageMapChange.fire();
		assert.equal(provider.packageMaps, undefined);
		assert.equal(provider.packageMapDiscovery, undefined);

		await provider.provideTerminalLinks(terminalLinkContext("package:foo/main.dart"), fakeCancellationToken);
		assert.equal(helloWorldLoadCalls(), 2);

		// Firing onPackageMapChange while discovery is in-flight clears packageMapDiscovery so a concurrent call starts fresh discovery.
		workspaceContext.events.onPackageMapChange.fire();
		const inFlight1 = provider.provideTerminalLinks(terminalLinkContext("package:foo/main.dart"), fakeCancellationToken);
		const invalidatedDiscoveryPromise = provider.packageMapDiscovery;
		assert.ok(invalidatedDiscoveryPromise);
		workspaceContext.events.onPackageMapChange.fire();
		assert.equal(provider.packageMapDiscovery, undefined);
		const inFlight2 = provider.provideTerminalLinks(terminalLinkContext("package:foo/main.dart"), fakeCancellationToken);
		assert.ok(provider.packageMapDiscovery);
		assert.notStrictEqual(provider.packageMapDiscovery, invalidatedDiscoveryPromise);
		await Promise.all([inFlight1, inFlight2]);
		assert.equal(helloWorldLoadCalls(), 4);
	});

	it("shows an error message when no results", () => {
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves();
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();

		// When packageMaps is not initialized.
		provider.handleTerminalLink(link);
		assert.equal(showErrorMessage.calledOnceWithExactly("Unable to find root for package foo"), true);

		// When packageMaps is initialized but no project resolves the URI.
		showErrorMessage.resetHistory();
		provider.packageMaps = {
			project1: fakePackageMap({}, () => undefined),
		};
		provider.handleTerminalLink(link);
		assert.equal(showErrorMessage.calledOnceWithExactly("Unable to find root for package foo"), true);
		assert.equal(executeCommand.called, false);
	});

	it("navigates directly for a single result", () => {
		provider.packageMaps = {
			project1: fakePackageMap({}, () => file1),
		};
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const jumpToLineCol = executeCommand.withArgs("_dart.jumpToLineColInUri", sinon.match.any, 1, 2).resolves();

		provider.handleTerminalLink(link);

		assert.equal(jumpToLineCol.calledOnce, true);
		const [, uri] = jumpToLineCol.firstCall.args as [unknown, vs.Uri];
		assert.equal(fsPath(uri), file1);
	});

	it("shows peek when multiple results", () => {
		provider.packageMaps = {
			project1: fakePackageMap({}, () => file1),
			project2: fakePackageMap({}, () => file2),
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

		// Also verify default 0,0 position when line and col are undefined.
		goToLocations.resetHistory();
		provider.handleTerminalLink({ ...link, line: undefined, col: undefined });
		assert.equal(goToLocations.calledOnce, true);
		const [, , defaultPosition] = goToLocations.firstCall.args as [unknown, vs.Uri, vs.Position];
		assert.equal(defaultPosition.line, 0);
		assert.equal(defaultPosition.character, 0);
	});

	describe("provideDocumentLinks", () => {
		it("returns empty array for non-Dart documents or when project root is not found", async () => {
			const yamlDoc = await vs.workspace.openTextDocument(helloWorldPubspec);
			assert.deepStrictEqual(await provider.provideDocumentLinks(yamlDoc, fakeCancellationToken), []);

			const dartDoc = await vs.workspace.openTextDocument(emptyFile);
			bestProjectRoot = undefined;
			assert.deepStrictEqual(await provider.provideDocumentLinks(dartDoc, fakeCancellationToken), []);

			bestProjectRoot = "/unknown/project";
			provider.packageMaps = {
				[fsPath(helloWorldFolder)]: fakePackageMap({ foo: "/foo" }, () => file1),
			};
			assert.deepStrictEqual(await provider.provideDocumentLinks(dartDoc, fakeCancellationToken), []);

			// Also returns empty array if onPackageMapChange invalidates packageMaps during discovery.
			bestProjectRoot = fsPath(helloWorldFolder);
			provider.packageMaps = undefined;
			provider.packageMapDiscovery = undefined;
			sb.stub(PackageMap, "loadForProject").callsFake((_logger, projectFolder) => {
				if (projectFolder.endsWith("nested_flutter_example"))
					workspaceContext.events.onPackageMapChange.fire();
				return fakePackageMap({ foo: "/foo" }, () => file1);
			});
			assert.deepStrictEqual(await provider.provideDocumentLinks(dartDoc, fakeCancellationToken), []);
		});

		it("discovers package maps and resolves links from current project or fallback projects", async () => {
			bestProjectRoot = fsPath(helloWorldFolder);
			sb.stub(PackageMap, "loadForProject").callsFake((_logger, projectFolder) => {
				if (projectFolder === fsPath(helloWorldFolder)) {
					return fakePackageMap(
						{ foo: "/foo", unresolvable: "/unresolvable", invalidated: "/invalidated" },
						(uri: string) => {
							if (uri === "package:foo/main.dart")
								return file1;
							if (uri === "package:invalidated/gone.dart")
								workspaceContext.events.onPackageMapChange.fire();
							return undefined;
						},
					);
				}
				if (projectFolder === fsPath(helloWorldExampleSubFolder)) {
					return fakePackageMap(
						{ bar: "/bar" },
						(uri: string) => uri === "package:bar/other.dart" ? file2 : undefined,
					);
				}
				return fakePackageMap({}, () => undefined);
			});

			await openFile(emptyFile);
			await setTestContent([
				"// See package:foo/main.dart:5:8 for details",
				"// Also package:bar/other.dart:10 and package:unresolvable/missing.dart",
				"// And package:invalidated/gone.dart",
			].join("\n"));

			const doc = currentDoc();
			const links = await provider.provideDocumentLinks(doc, fakeCancellationToken);

			assert.equal(links.length, 2);
			assert.deepStrictEqual(links[0].range, rangeOf("|package:foo/main.dart:5:8|", doc));
			assert.equal(fsPath(links[0].target!), file1);
			assert.equal(links[0].target!.fragment, "5,8");

			assert.deepStrictEqual(links[1].range, rangeOf("|package:bar/other.dart:10|", doc));
			assert.equal(fsPath(links[1].target!), file2);
			assert.equal(links[1].target!.fragment, "10");
		});
	});
});
