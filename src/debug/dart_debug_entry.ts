import { DebugSession } from "vscode-debugadapter";
import { DartDebugSession } from "./dart_debug_impl";

DebugSession.run(DartDebugSession);
