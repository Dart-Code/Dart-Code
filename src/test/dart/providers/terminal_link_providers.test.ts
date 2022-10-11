
import { strict as assert } from "assert";
import { isWin } from "../../../shared/constants";
import { fsPath } from "../../../shared/utils/fs";
import { findFileUriLinks, findPackageUriLinks } from "../../../shared/vscode/terminal_link_provider_utils";
import { activate } from "../../helpers";

describe("DartFileUriTerminalLinkProvider", () => {
	beforeEach("activate", () => activate());

	it("detects macOS/Linux links without drive letters", async function () {
		if (isWin)
			this.skip();
		await expectLink("file:///foo/bar.dart", "/foo/bar.dart");
		await expectLink("file:///foo/bar.dart:5:8", "/foo/bar.dart", 5, 8);
		await expectLink("file:///foo/bar.dart 5:8", "/foo/bar.dart", 5, 8);
		await expectLink("aaa file:///foo/bar.dart:5:8 bbb", "/foo/bar.dart", 5, 8);
	});

	it("detects Windows links with drive letters", async function () {
		if (!isWin)
			this.skip();
		await expectLink("file:///C:/foo/bar.dart", "C:\\foo\\bar.dart");
		await expectLink("file:///C:/foo/bar.dart:5:8", "C:\\foo\\bar.dart", 5, 8);
		await expectLink("file:///C:/foo/bar.dart 5:8", "C:\\foo\\bar.dart", 5, 8);
		await expectLink("aaa file:///C:/foo/bar.dart:5:8 bbb", "C:\\foo\\bar.dart", 5, 8);
	});

	it("detects Windows links with lowercase drive letters", async function () {
		if (!isWin)
			this.skip();
		await expectLink("file:///c:/foo/bar.dart", "C:\\foo\\bar.dart");
		await expectLink("file:///c:/foo/bar.dart:5:8", "C:\\foo\\bar.dart", 5, 8);
		await expectLink("file:///c:/foo/bar.dart 5:8", "C:\\foo\\bar.dart", 5, 8);
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
