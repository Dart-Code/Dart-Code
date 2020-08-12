import * as path from "path";
import { DebuggerType } from "../enums";

export function getDebugAdapterPath(asAbsolutePath: (path: string) => string, debugType: DebuggerType) {
	let debuggerScript: string;
	switch (debugType) {
		case DebuggerType.Flutter:
			debuggerScript = "flutter_debug_entry";
			break;
		case DebuggerType.FlutterTest:
			debuggerScript = "flutter_test_debug_entry";
			break;
		case DebuggerType.Web:
			debuggerScript = "web_debug_entry";
			break;
		case DebuggerType.WebTest:
			debuggerScript = "web_test_debug_entry"
			break;
		case DebuggerType.Dart:
			debuggerScript = "dart_debug_entry";
			break;
		case DebuggerType.PubTest:
			debuggerScript = "dart_test_debug_entry";
			break;
		default:
			throw new Error("Unknown debugger type");
	}

	return asAbsolutePath(`./out/src/debug/${debuggerScript}.js`);
}

export function getDebugAdapterPort(debuggerScript: string) {
	// Get filename without extension.
	debuggerScript = path.basename(debuggerScript).split(".")[0];
	const debugAdapterScripts = [
		"flutter_debug_entry",
		"flutter_test_debug_entry",
		"web_debug_entry",
		"web_test_debug_entry",
		"dart_debug_entry",
		"dart_test_debug_entry",
	];
	const index = debugAdapterScripts.indexOf(debuggerScript);
	if (index === -1)
		throw new Error("Unknown debugger type");
	return 4711 + index;
}
