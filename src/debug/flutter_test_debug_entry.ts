import { DebugSession } from "vscode-debugadapter";
import { FlutterTestDebugSession } from "./flutter_test_debug_impl";

DebugSession.run(FlutterTestDebugSession);
