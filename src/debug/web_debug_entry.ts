import { DebugSession } from "vscode-debugadapter";
import { WebDebugSession } from "./web_debug_impl";

DebugSession.run(WebDebugSession);
