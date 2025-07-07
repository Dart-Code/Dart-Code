import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import { isWin } from "../../../shared/constants";
import { GetSDKCommandConfig } from "../../../shared/interfaces";
import { fsPath, pubspecContentReferencesFlutter } from "../../../shared/utils/fs";
import { activate, helloWorldFolder, privateApi } from "../../helpers";

describe("pubspecContentReferencesFlutter", () => {
	it("returns false for non-Flutter pubspec.yaml", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: foo
version: 1.2.3

dependencies:
  not_a_flutter_dep:
		`);
		assert.equal(isFlutter, false);
	});

	it("returns true for standard Flutter pubspec.yaml", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dependencies:
  flutter:
    sdk: flutter
		`);
		assert.equal(isFlutter, true);
	});

	it("returns true for Flutter pubspec.yaml with extra whitespace", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dependencies:
  flutter:
    sdk:     flutter      #
		`);
		assert.equal(isFlutter, true);
	});

	it("returns true for Flutter pubspec.yaml with no whitespace", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dependencies:
  flutter:
    sdk:flutter
		`);
		assert.equal(isFlutter, true);
	});

	it("returns true for Flutter pubspec.yaml with double quotes", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dependencies:
  flutter:
    sdk: "flutter"
		`);
		assert.equal(isFlutter, true);
	});

	it("returns true for Flutter pubspec.yaml with single quotes", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dependencies:
  flutter:
    sdk: 'flutter'
		`);
		assert.equal(isFlutter, true);
	});

	it("returns false if the dependency is commented out", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

dev_dependencies:
  # flutter:
  #   sdk: flutter
  lints: ^2.0.0
		`);
		assert.equal(isFlutter, false);
	});

	it("returns true for only sky_engine dev_dependency in pubspec.yaml", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dependencies:
  sky_engine:
    sdk: flutter
		`);
		assert.equal(isFlutter, true);
	});

	it("returns true for only flutter_test dev_dependency in pubspec.yaml", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dev_dependencies:
  flutter_test:
    sdk: flutter
		`);
		assert.equal(isFlutter, true);
	});
});


describe("runCustomGetSDKCommand", () => {
	// The script takes two inputs for testing both args and env vars:
	//
	// 1. The first argument is the exit code to return
	// 2. The "DB_TEST_DART_PATH" env variable is the SDK path to print as output
	const shellExt = isWin ? ".bat" : ".sh";
	const executable = path.join(fsPath(helloWorldFolder), "scripts", `custom_dart_path${shellExt}`);
	before(() => fs.chmodSync(executable, "775"));

	beforeEach("activate", async () => {
		await activate();
	});

	async function runCommand(exitCode: number, outputPath: string | undefined) {
		const command: GetSDKCommandConfig = {
			args: [`${exitCode}`],
			cwd: undefined,
			env: outputPath ? {
				DC_TEST_DART_PATH: outputPath,
			} : undefined,
			executable,
		};
		return privateApi.sdkUtils?.runCustomGetSDKCommand(command, "dart.getDartSdkCommand", false);
	}

	it("handles valid path", async () => {
		const result = await runCommand(0, privateApi.workspaceContext.sdks.dart);
		assert.equal(result?.error, undefined);
		assert.equal(result?.path, privateApi.workspaceContext.sdks.dart);
	});

	it("handles missing SDK path", async () => {
		const result = await runCommand(0, path.join(privateApi.workspaceContext.sdks.dart, "fake"));
		assert.ok(result?.error?.includes("Path does not exist:"));
		assert.equal(result?.path, undefined);
	});

	it("handles no output", async () => {
		const result = await runCommand(0, undefined);
		assert.ok(result?.error?.includes("No output from command"));
		assert.equal(result?.path, undefined);
	});

	it("handles non-zero exit code", async () => {
		// Use a valid SDK path to ensure it's ignored.
		const result = await runCommand(123, privateApi.workspaceContext.sdks.dart);
		assert.ok(result?.error?.includes("Exited with non-zero code (123)"));
		assert.equal(result?.path, undefined);
	});
});
