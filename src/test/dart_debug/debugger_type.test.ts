import { DebuggerType } from "../../shared/enums";
import { activate, helloWorldFolder } from "../helpers";
import { runDebuggerTypeTests } from "../shared/debugger_types";

describe("dart debugger type", async () => {
	beforeEach("activate", () => activate(null));

	const tests: Array<{ program: string, cwd?: string, debugger: DebuggerType }> = [
		// All POSIX paths, Windows handled below.
		// These files should not exist, they are created as part of the test.
		{ program: "bin/temp.dart", debugger: DebuggerType.Dart },
		{ program: "bin/temp_tool.dart", debugger: DebuggerType.Dart },
		{ program: "lib/temp1_test.dart", debugger: DebuggerType.Dart },
		{ program: "lib/temp2_test.dart*", debugger: DebuggerType.DartTest }, // Special case for allowTestsOutsideTestFolder
		{ program: "test/temp_test.dart", debugger: DebuggerType.DartTest },
		{ program: "test/tool/temp_tool_test.dart", debugger: DebuggerType.DartTest },
		{ program: "tool/temp_tool.dart", debugger: DebuggerType.Dart },
	];

	await runDebuggerTypeTests(tests, helloWorldFolder);
});
