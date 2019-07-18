import { DebugSession } from "vscode-debugadapter";
import { FlutterWebDebugSession } from "./flutter_web_debug_impl";

DebugSession.run(FlutterWebDebugSession);
