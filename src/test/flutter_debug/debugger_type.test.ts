import { DebuggerType } from "../../shared/enums";
import { flutterTestDeviceIsWeb } from "../debug_helpers";
import { activateWithoutAnalysis, flutterHelloWorldFolder } from "../helpers";
import { runDebuggerTypeTests } from "../shared/debugger_types";

describe.only(`flutter debugger type`, async () => {
	beforeEach("Skip not-device-specific tests on web", function () {
		if (flutterTestDeviceIsWeb)
			this.skip();
	});

	beforeEach("activate", () => activateWithoutAnalysis(null));

	const tests: Array<{ program: string, cwd?: string, debuggerType?: DebuggerType, expectedDebuggerType: DebuggerType }> = [
		// All POSIX paths, Windows handled inside runDebuggerTypeTests.

		// These files should not exist, they are created as part of the test.
		{ program: "bin/temp_tool.dart", expectedDebuggerType: DebuggerType.Dart },
		{ program: "lib/temp.dart", expectedDebuggerType: DebuggerType.Flutter },
		{ program: "lib/temp1_test.dart", expectedDebuggerType: DebuggerType.Flutter },
		{ program: "lib/temp2_test.dart*", expectedDebuggerType: DebuggerType.FlutterTest }, // Special case for allowTestsOutsideTestFolder
		{ program: "test/temp_test.dart", expectedDebuggerType: DebuggerType.FlutterTest },
		{ program: "test/tool/temp_tool_test.dart", expectedDebuggerType: DebuggerType.FlutterTest },
		{ program: "tool/temp_tool.dart", expectedDebuggerType: DebuggerType.Dart },
		// CWD here, but Program in another Flutter project.
		{
			// CWD defaults to this project.
			expectedDebuggerType: DebuggerType.Flutter,
			program: "../dart_nested_flutter/nested_flutter_example/lib/temp.dart",
		},
		// CWD in another Flutter project, but tool here.
		{
			cwd: "../dart_nested_flutter/nested_flutter_example",
			expectedDebuggerType: DebuggerType.Dart,
			program: "../../flutter_hello_world/tool/temp_tool.dart",
		},
		// CWD here, but Program in another Dart project.
		{
			// CWD defaults to this project.
			expectedDebuggerType: DebuggerType.Dart,
			program: "../hello_world/bin/temp.dart",
		},
		// CWD in another Dart project, but app here.
		{
			cwd: "../hello_world",
			expectedDebuggerType: DebuggerType.Flutter,
			program: "../flutter_hello_world/lib/temp.dart",
		},
		// Explicit debuggerType is always kept, to allow other extensions to force a particular type regardless of
		// our rules.
		{ program: "lib/temp.dart", debuggerType: DebuggerType.Dart, expectedDebuggerType: DebuggerType.Dart },
	];

	await runDebuggerTypeTests(tests, flutterHelloWorldFolder);
});
