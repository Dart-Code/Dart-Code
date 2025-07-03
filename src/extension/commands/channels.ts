import * as vs from "vscode";
import { SpawnedProcess } from "../../shared/interfaces";

const channels: Record<string, vs.OutputChannel> = {};

export function getOutputChannel(name: string, insertDivider = false): vs.OutputChannel {
	if (!channels[name]) {
		channels[name] = vs.window.createOutputChannel(name);
	} else if (insertDivider) {
		const ch = channels[name];
		ch.appendLine("");
		ch.appendLine("--");
		ch.appendLine("");
	}

	return channels[name];
}

export function runProcessInOutputChannel(process: SpawnedProcess, channel: vs.OutputChannel) {
	process.stdout.on("data", (data: Buffer | string) => channel.append(data.toString()));
	process.stderr.on("data", (data: Buffer | string) => channel.append(data.toString()));
	process.on("close", (code) => channel.appendLine(`exit code ${code}`));
}

