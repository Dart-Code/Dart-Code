import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { activate, extApi, helloWorldFolder, tryDeleteDirectoryRecursive } from "../../helpers";

describe("dart tasks", () => {
	beforeEach("activate", () => activate());
	const dartDocOutputPath = path.join(fsPath(helloWorldFolder), "doc");
	beforeEach("clear out sample folder", () => tryDeleteDirectoryRecursive(dartDocOutputPath));

	it("dart.task.dartdoc causes documentation to be generated", async function () {
		// https://github.com/dart-lang/dartdoc/issues/3823
		if (extApi.dartCapabilities.version.startsWith("3.5."))
			this.skip();

		assert.ok(!fs.existsSync(dartDocOutputPath));
		await new Promise<void>(async (resolve, reject) => {
			vs.tasks.onDidEndTaskProcess((task) => {
				if (task.execution === taskExecution) {
					if (task.exitCode)
						reject(new Error(`Task quit with code ${task.exitCode}`));
					else
						resolve();
				}
			});
			const taskExecution = await vs.commands.executeCommand<vs.TaskExecution>("dart.task.dartdoc");
		});
		assert.ok(fs.existsSync(dartDocOutputPath));
	});
});
