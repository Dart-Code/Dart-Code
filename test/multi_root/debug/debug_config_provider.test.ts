import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, doc, setTestContent, editor, eol } from "../../helpers";

describe("debug_config_provider", () => {

	before(() => activate());

	it("returns the flutter debug entry script", async () => {
		const entry = await vs.commands.executeCommand("dart.getDebuggerExecutable", vs.workspace.workspaceFolders[0].uri.toString()) as { args: string[], command: string };
		assert.ok(entry);
		assert.ok(entry.args);
		assert.equal(entry.args.length, 1);
		assert.notEqual(entry.args[0].indexOf("flutter_debug_entry"), -1);
	});

	it("returns the dart debug entry script", async () => {
		const entry = await vs.commands.executeCommand("dart.getDebuggerExecutable", vs.workspace.workspaceFolders[1].uri.toString()) as { args: string[], command: string };
		assert.ok(entry);
		assert.ok(entry.args);
		assert.equal(entry.args.length, 1);
		assert.notEqual(entry.args[0].indexOf("dart_debug_entry"), -1);
	});
});
