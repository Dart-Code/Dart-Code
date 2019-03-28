import { DebugSession } from "vscode-debugadapter";
import { FlutterWebTestDebugSession } from "./flutter_web_test_debug_impl";

DebugSession.run(FlutterWebTestDebugSession);
