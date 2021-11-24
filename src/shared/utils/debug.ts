import { DebuggerType } from "../enums";

export function getDebugAdapterName(debugType: DebuggerType) {
	let debuggerName: string;
	switch (debugType) {
		case DebuggerType.Flutter:
			debuggerName = "flutter";
			break;
		case DebuggerType.FlutterTest:
			debuggerName = "flutter_test";
			break;
		case DebuggerType.Web:
			debuggerName = "web";
			break;
		case DebuggerType.WebTest:
			debuggerName = "web_test";
			break;
		case DebuggerType.Dart:
			debuggerName = "dart";
			break;
		case DebuggerType.DartTest:
			debuggerName = "dart_test";
			break;
		default:
			throw new Error(`Unknown debugger type: ${debugType}`);
	}

	return debuggerName;
}

export function getDebugAdapterPort(debuggerName: string) {
	const debugAdapterNames = [
		"flutter",
		"flutter_test",
		"web",
		"web_test",
		"dart",
		"dart_test",
	];
	const index = debugAdapterNames.indexOf(debuggerName);
	if (index === -1)
		throw new Error(`Unknown debugger type: ${debuggerName}`);
	return 4711 + index;
}
