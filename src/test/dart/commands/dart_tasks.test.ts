import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { executableNames } from "../../../shared/constants";
import { fsPath } from "../../../shared/utils/fs";
import { activate, defer, helloWorldFolder, sb } from "../../helpers";

describe("dart tasks", () => {
	beforeEach("activate", () => activate());

	it("dart.task.dartdoc causes documentation to be generated", async () => {
		const executeTask = sb.stub(vs.tasks, "executeTask").resolves(undefined);

		await vs.commands.executeCommand("dart.task.dartdoc");

		assert.ok(executeTask.calledOnce);
		const task = executeTask.firstCall.args[0] as vs.Task;
		assert.equal(fsPath((task.scope as vs.WorkspaceFolder).uri), fsPath(helloWorldFolder));
		const execution = task.execution as vs.ProcessExecution;
		assert.ok(execution.process.endsWith(executableNames.dart), `Task execution process was ${execution.process}`);
		assert.deepEqual(execution.args, ["doc", "."]);
		assert.equal(execution.options?.cwd, "");
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
