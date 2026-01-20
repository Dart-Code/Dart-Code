import { strict as assert } from "assert";
import * as vs from "vscode";
import { IAmDisposable } from "../../../shared/interfaces";
import { disposeAll } from "../../../shared/utils";
import { fsPath } from "../../../shared/utils/fs";
import { activate, closeFile, defer, helloWorldMainFile, openFile } from "../../helpers";

describe("helpers", () => {
	beforeEach("activate emptyFile", () => activate());

	it("closeFile forces VS Code to run onDidCloseTextDocument", async () => {
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

		for (let i = 0; i < 10; i++) {
			await openFile(helloWorldMainFile);
			await closeFile(helloWorldMainFile);
		}

		assert.equal(openEvents, 10);
		assert.equal(closeEvents, 10);
	});
});
