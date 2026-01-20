import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { executableNames } from "../../../shared/constants";
import { fsPath } from "../../../shared/utils/fs";
import { activate, defer, helloWorldFolder, privateApi, tryDeleteDirectoryRecursive } from "../../helpers";

describe("dart tasks", () => {
	beforeEach("activate", () => activate());
	const dartDocOutputPath = path.join(fsPath(helloWorldFolder), "doc");
	beforeEach("clear out sample folder", () => tryDeleteDirectoryRecursive(dartDocOutputPath));

	it("dart.task.dartdoc causes documentation to be generated", async function () {
		// https://github.com/dart-lang/dartdoc/issues/3823
		if (privateApi.dartCapabilities.version.startsWith("3.5."))
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

	it("includes build_runner tasks that use 'dart run'", async () => {
		const pubspecPath = path.join(fsPath(helloWorldFolder), "pubspec.yaml");
		const originalPubspec = fs.readFileSync(pubspecPath, "utf8");

		// Temporarily add build_runner to pubspec.
		fs.writeFileSync(pubspecPath, originalPubspec + "\n  build_runner:");
		defer("revert pubspec", () => fs.writeFileSync(pubspecPath, originalPubspec));

		// Check for task.
		const tasks = await vs.tasks.fetchTasks();
		const buildTask = tasks.find((t) => t.name === "dart run build_runner build");
		assert.ok(buildTask, "build_runner task not found");

		// Verify command is as expected.
		const execution = buildTask.execution as vs.ProcessExecution;
		assert.ok(execution.process.endsWith(executableNames.dart), `Task execution process was ${execution.process}`);
		assert.deepEqual(execution.args, ["run", "build_runner", "build"]);
	});
});
