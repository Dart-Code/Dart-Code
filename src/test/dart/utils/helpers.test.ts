import { strict as assert } from "assert";
import * as vs from "vscode";
import { IAmDisposable } from "../../../shared/interfaces";
import { disposeAll } from "../../../shared/utils";
import { fsPath } from "../../../shared/utils/fs";
import { activate, closeAllOpenFiles, closeFile, defer, delay, forceDocumentCloseEvents, helloWorldMainFile, openFile } from "../../helpers";

describe("helpers", () => {
	beforeEach("activate emptyFile", () => activate());

	it("closeFile forces VS Code to run onDidCloseTextDocument", async () => {
		// Ensure there are no existing docs that could interfere with our numbers, since
		// we check for an exact count.
		await closeAllOpenFiles();
		await forceDocumentCloseEvents();
		await delay(100);

		let openEvents = 0;
		let closeEvents = 0;

		const disposables: IAmDisposable[] = [];
		defer("dispose", () => disposeAll(disposables));

		disposables.push(vs.workspace.onDidOpenTextDocument((e) => {
			if (e.uri.scheme === "file" && fsPath(e.uri) === fsPath(helloWorldMainFile))
				openEvents++;
		}));

		disposables.push(vs.workspace.onDidCloseTextDocument((e) => {
			if (e.uri.scheme === "file" && fsPath(e.uri) === fsPath(helloWorldMainFile))
				closeEvents++;
		}));

		const NUMBER_FILE_OPENS = 3;
		for (let i = 0; i < NUMBER_FILE_OPENS; i++) {
			await openFile(helloWorldMainFile);
			await closeFile(helloWorldMainFile);
		}
		await delay(100);

		assert.equal(openEvents, NUMBER_FILE_OPENS);
		assert.equal(closeEvents, NUMBER_FILE_OPENS);
	});
});
