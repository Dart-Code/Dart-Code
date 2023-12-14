import { DebuggerType } from "../../shared/enums";
import { waitFor } from "../../shared/utils/promises";
import { flutterTestDeviceId, flutterTestDeviceIsWeb } from "../debug_helpers";
import { activate, extApi, flutterHelloWorldFolder } from "../helpers";
import { runDebuggerTypeTests } from "../shared/debugger_types";

describe(`flutter debugger type`, async () => {
	beforeEach("activate", () => activate(null));

	beforeEach("Wait for device to be available", async () => {
		// For web, the device doesn't show up immediately so we need to wait
		// otherwise we will prompt to select a device when starting the debug
		// session in the test. This is not required for flutter-tester as that
		// bypasses the device check.
		if (flutterTestDeviceIsWeb)
			await waitFor(() => extApi.deviceManager!.getDevice(flutterTestDeviceId));
	});

	const tests: Array<{ program: string, cwd?: string, debugger: DebuggerType }> = [
		// All POSIX paths, Windows handled below.
		// These files should not exist, they are created as part of the test.
		{ program: "bin/temp_tool.dart", debugger: DebuggerType.Dart },
		{ program: "lib/temp.dart", debugger: DebuggerType.Flutter },
		{ program: "lib/temp1_test.dart", debugger: DebuggerType.Flutter },
		{ program: "lib/temp2_test.dart*", debugger: DebuggerType.FlutterTest }, // Special case for allowTestsOutsideTestFolder
		{ program: "test/temp_test.dart", debugger: DebuggerType.FlutterTest },
		{ program: "test/tool/temp_tool_test.dart", debugger: DebuggerType.FlutterTest },
		{ program: "tool/temp_tool.dart", debugger: DebuggerType.Dart },
		// CWD here, but Program in another Flutter project.
		{
			// CWD defaults to this project.
			debugger: DebuggerType.Flutter,
			program: "../dart_nested_flutter/nested_flutter_example/lib/temp.dart",
		},
		// CWD in another Flutter project, but tool here.
		{
			cwd: "../dart_nested_flutter/nested_flutter_example",
			debugger: DebuggerType.Dart,
			program: "../../flutter_hello_world/tool/temp_tool.dart",
		},
		// CWD here, but Program in another Dart project.
		{
			// CWD defaults to this project.
			debugger: DebuggerType.Dart,
			program: "../hello_world/bin/temp.dart",
		},
		// CWD in another Dart project, but app here.
		{
			cwd: "../hello_world",
			debugger: DebuggerType.Flutter,
			program: "../flutter_hello_world/lib/temp.dart",
		},
	];

	await runDebuggerTypeTests(tests, flutterHelloWorldFolder);
});
