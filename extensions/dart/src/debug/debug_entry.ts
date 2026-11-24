import { DebugSession } from "@vscode/debugadapter";
import { WebDebugSession } from "./web_debug_impl";

const args = process.argv.slice(2);
const debuggerType = args.length ? args[0] : undefined;

const debuggers: { [key: string]: any } = {
	web: WebDebugSession,
};

const dbg = debuggerType ? debuggers[debuggerType] as typeof DebugSession : undefined;
if (dbg) {
	DebugSession.run(dbg);
} else {
	throw new Error(`debuggerType must be one of ${Object.keys(debuggers).join(", ")} but got ${debuggerType}.\n  argv: ${process.argv.join("    ")}`);
}
