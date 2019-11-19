import { DebugSession } from "vscode-debugadapter";
import { WebTestDebugSession } from "./web_test_debug_impl";

DebugSession.run(WebTestDebugSession);
