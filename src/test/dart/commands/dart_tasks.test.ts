import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { activate, deleteDirectoryRecursive, helloWorldFolder } from "../../helpers";

describe("dart tasks", () => {
	beforeEach("activate", () => activate());
	const dartDocOutputPath = path.join(fsPath(helloWorldFolder), "doc");
	beforeEach("clear out sample folder", () => deleteDirectoryRecursive(dartDocOutputPath));

	it("dart.task.dartdoc causes documentation to be generated", async () => {
		assert.ok(!fs.existsSync(dartDocOutputPath));
		await new Promise<void>(async (resolve, reject) => {
			vs.tasks.onDidEndTaskProcess((task) => {
				if (task.execution === taskExecution)
					task.exitCode ? reject(new Error(`Task quit with code ${task.exitCode}`)) : resolve();
			});
			const taskExecution = await vs.commands.executeCommand("dart.task.dartdoc") as vs.TaskExecution;
		});
		assert.ok(fs.existsSync(dartDocOutputPath));
	});
});
