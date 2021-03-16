import * as vs from "vscode";
import { SpawnedProcess } from "../../shared/interfaces";

const channels: { [key: string]: vs.OutputChannel } = {};

export function getOutputChannel(name: string, clear = false): vs.OutputChannel {
	if (!channels[name])
		channels[name] = vs.window.createOutputChannel(name);
	else if (clear)
		channels[name].clear();

	return channels[name];
}

export function runProcessInOutputChannel(process: SpawnedProcess, channel: vs.OutputChannel) {
	process.stdout.on("data", (data) => channel.append(data.toString()));
	process.stderr.on("data", (data) => channel.append(data.toString()));
	process.on("close", (code) => channel.appendLine(`exit code ${code}`));
}

