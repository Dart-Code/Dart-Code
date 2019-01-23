import * as child_process from "child_process";
import { LogCategory, LogSeverity } from "../debug/utils";
import { log } from "./log";

export function logProcess(category: LogCategory, prefix: string, process: child_process.ChildProcess): void {
	process.stdout.on("data", (data) => log(`${prefix} ${data}`, LogSeverity.Info, category));
	process.stderr.on("data", (data) => log(`${prefix} ${data}`, LogSeverity.Info, category));
	process.on("close", (code) => log(`${prefix} exit code ${code}`, LogSeverity.Info, category));
}
