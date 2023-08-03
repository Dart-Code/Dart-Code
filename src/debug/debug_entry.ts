import { DebugSession } from "@vscode/debugadapter";
import { DartDebugSession } from "./dart_debug_impl";
import { DartTestDebugSession } from "./dart_test_debug_impl";
import { FlutterDebugSession } from "./flutter_debug_impl";
import { FlutterTestDebugSession } from "./flutter_test_debug_impl";
import { WebDebugSession } from "./web_debug_impl";
import { WebTestDebugSession } from "./web_test_debug_impl";

const args = process.argv.slice(2);
const debugType = args.length ? args[0] : undefined;

const debuggers: { [key: string]: any } = {
	// These IDs are passed as arguments so cannot be renamed to camelCase.
	dart: DartDebugSession,
	// eslint-disable-next-line camelcase
	dart_test: DartTestDebugSession,
	flutter: FlutterDebugSession,
	// eslint-disable-next-line camelcase
	flutter_test: FlutterTestDebugSession,
	web: WebDebugSession,
	// eslint-disable-next-line camelcase
	web_test: WebTestDebugSession,
};

const dbg = debugType ? debuggers[debugType] as typeof DebugSession : undefined;
if (dbg) {
	DebugSession.run(dbg);
} else {
	throw new Error(`Debugger type must be one of ${Object.keys(debuggers).join(", ")} but got ${debugType}.\n  argv: ${process.argv.join("    ")}`);
}
