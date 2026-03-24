import { strict as assert } from "assert";
import * as vs from "vscode";
import { platformDisplayName } from "../../../shared/constants";
import { fsPath } from "../../../shared/utils/fs";
import { extensionVersion } from "../../../shared/vscode/extension_utils";
import { activate, currentDoc } from "../../helpers";

describe("diagnostic report", () => {
	beforeEach("activate", () => activate());

	it("opens a log with the expected contents", async () => {
		await vs.commands.executeCommand("dart.generateDiagnosticReport");

		const doc = currentDoc();
		const logPath = fsPath(doc.uri);
		const contents = doc.getText();
		assert.ok(logPath.endsWith(".md"));
		assert.ok(contents.includes("⚠️ PLEASE REVIEW THIS REPORT FOR SENSITIVE INFORMATION BEFORE SHARING ⚠️"));
		assert.ok(contents.includes(`Dart Code extension: ${extensionVersion}`));
		assert.ok(contents.includes(`App: ${vs.env.appName}`));
		assert.ok(contents.includes(`App Host: desktop`));
		assert.ok(contents.includes(`Version: ${platformDisplayName} ${vs.version}`));
		assert.ok(contents.includes(`<summary><strong>Output from 'dart info'</strong></summary>`));
		assert.ok(contents.includes(`#### Project info`));
		assert.ok(contents.includes(`dependencies: `));
		assert.ok(contents.includes(`#### Process info`));
	});
});
