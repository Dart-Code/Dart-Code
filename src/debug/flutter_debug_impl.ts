"use strict";

import { DartDebugSession, DartLaunchRequestArguments } from "./dart_debug_impl";
import * as child_process from "child_process";
import { DebugProtocol } from "vscode-debugprotocol";
import { TerminatedEvent } from "vscode-debugadapter";

export class FlutterDebugSession extends DartDebugSession {
}
