import { DebuggerType } from "../../shared/enums";
import { activateWithoutAnalysis, helloWorldFolder } from "../helpers";
import { runDebuggerTypeTests } from "../shared/debugger_types";

describe("dart debugger type", async () => {
	beforeEach("activate", () => activateWithoutAnalysis(null));

	const tests: Array<{ program: string, cwd?: string, debuggerType?: DebuggerType | string, expectedDebuggerType: DebuggerType }> = [
		// All POSIX paths, Windows handled inside runDebuggerTypeTests.

		// These files should not exist, they are created as part of the test.
		{ program: "bin/temp.dart", expectedDebuggerType: DebuggerType.Dart },
		{ program: "bin/temp_tool.dart", expectedDebuggerType: DebuggerType.Dart },
		{ program: "lib/temp1_test.dart", expectedDebuggerType: DebuggerType.Dart },
		{ program: "lib/temp2_test.dart*", expectedDebuggerType: DebuggerType.DartTest }, // Special case for allowTestsOutsideTestFolder
		{ program: "test/temp_test.dart", expectedDebuggerType: DebuggerType.DartTest },
		{ program: "test/tool/temp_tool_test.dart", expectedDebuggerType: DebuggerType.DartTest },
		{ program: "tool/temp_tool.dart", expectedDebuggerType: DebuggerType.Dart },
		// Explicit debuggerType is always kept, to allow other extensions to force a particular type regardless of
		// our rules.
		{ program: "bin/temp.dart", debuggerType: DebuggerType.DartTest, expectedDebuggerType: DebuggerType.DartTest },
		// Explicit strings.
		{ program: "bin/temp.dart", debuggerType: "dart", expectedDebuggerType: DebuggerType.Dart },
		{ program: "bin/temp.dart", debuggerType: "dartTest", expectedDebuggerType: DebuggerType.DartTest },
		{ program: "test/temp_test.dart", debuggerType: "dart", expectedDebuggerType: DebuggerType.Dart },
		{ program: "test/temp_test.dart", debuggerType: "dartTest", expectedDebuggerType: DebuggerType.DartTest },
		// Case insensitivity.
		{ program: "bin/temp.dart", debuggerType: "DART", expectedDebuggerType: DebuggerType.Dart },
		{ program: "bin/temp.dart", debuggerType: "darttest", expectedDebuggerType: DebuggerType.DartTest },
	];

	await runDebuggerTypeTests(tests, helloWorldFolder);
});
