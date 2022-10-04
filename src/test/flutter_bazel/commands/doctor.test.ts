import { strict as assert } from "assert";
import * as vs from "vscode";
import { isWin } from "../../../shared/constants";
import { fsPath } from "../../../shared/utils/fs";
import { activate, captureOutput, ensureHasRunRecently, flutterBazelRoot, prepareHasRunFile } from "../../helpers";

describe("flutter doctor", () => {
	beforeEach(function () {
		if (isWin)
			this.skip();
	});

	beforeEach("activate", () => activate());

	it("runs and prints output using script", async () => {
		const root = fsPath(flutterBazelRoot);
		const hasRunFile = prepareHasRunFile(root, "doctor");

		const buffer = captureOutput("custom_doctor (flutter)");
		const exitCode = await vs.commands.executeCommand("flutter.doctor");
		assert.equal(exitCode, 0);

		const output = buffer.join("").trim();
		assert.equal(output.startsWith("--\n\n[flutter] custom_doctor --suppress-analytics -v"), true);
		assert.notEqual(output.indexOf("] Flutter (Channel"), -1);
		assert.equal(output.endsWith("exit code 0"), true);

		ensureHasRunRecently(root, hasRunFile);
	});
});
