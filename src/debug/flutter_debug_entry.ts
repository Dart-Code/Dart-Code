import { DebugSession } from "vscode-debugadapter";
import { FlutterDebugSession } from "./flutter_debug_impl";

DebugSession.run(FlutterDebugSession);
