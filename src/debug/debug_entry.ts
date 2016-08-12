'use strict';

import { DebugSession } from "vscode-debugadapter";
import { DartDebugSession } from "./debug_impl";

DebugSession.run(DartDebugSession);
