import { DebugSession } from "vscode-debugadapter";
import { DartTestDebugSession } from "./dart_test_debug_impl";

DebugSession.run(DartTestDebugSession);
