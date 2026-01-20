import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { executableNames } from "../../../shared/constants";
import { fsPath } from "../../../shared/utils/fs";
import { activate, defer, extApi, flutterHelloWorldFolder, getPackages } from "../../helpers";

describe("flutter tasks", () => {
	before("activate", () => activate());
	before("get packages", () => getPackages());

	it("includes build_runner tasks that use 'dart run' and have FLUTTER_ROOT", async () => {
		const pubspecPath = path.join(fsPath(flutterHelloWorldFolder), "pubspec.yaml");
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
		assert.equal(execution.options?.env?.FLUTTER_ROOT, extApi.sdks.flutter, "FLUTTER_ROOT was not set correctly in task environment");
	});
});
