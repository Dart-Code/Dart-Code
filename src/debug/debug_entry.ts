import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DebugSession } from "vscode-debugadapter";
import { DartDebugSession } from "./dart_debug_impl";
import { DartTestDebugSession } from "./dart_test_debug_impl";
import { FlutterDebugSession } from "./flutter_debug_impl";
import { FlutterTestDebugSession } from "./flutter_test_debug_impl";
import { WebDebugSession } from "./web_debug_impl";
import { WebTestDebugSession } from "./web_test_debug_impl";

const timestamp = Date.now();
const logFilename = path.join(os.tmpdir(), `dart-code-debug-adapter-log-${timestamp}.txt`);
const errorLogFilename = path.join(os.tmpdir(), `dart-code-debug-adapter-log-${timestamp}-error.txt`);
fs.writeFileSync(logFilename, `Dart debug adaper spawned ${process.argv} /  ${process.execArgv} / ${process.execPath}`);
process.on("uncaughtException", (e) => fs.writeFileSync(errorLogFilename, e));

const args = process.argv.slice(2);
const debugType = args.length ? args[0] : undefined;

const debuggers: { [key: string]: any } = {
	"dart": DartDebugSession,
	"dart_test": DartTestDebugSession,
	"flutter": FlutterDebugSession,
	"flutter_test": FlutterTestDebugSession,
	"web": WebDebugSession,
	"web_test": WebTestDebugSession,
};

const dbg = debugType ? debuggers[debugType] : undefined;
if (dbg) {
	DebugSession.run(dbg);
} else {
	throw new Error(`Debugger type must be one of ${Object.keys(debuggers).join(", ")} but got ${debugType}.\n  argv: ${process.argv.join("    ")}`);
}
