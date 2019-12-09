import * as vs from "vscode";
import { SpawnedProcess } from "../../shared/interfaces";

const channels: { [key: string]: vs.OutputChannel } = {};

export function createChannel(name: string): vs.OutputChannel {
	if (!channels[name])
		channels[name] = vs.window.createOutputChannel(name);

	return channels[name];
}

export function getChannel(name: string): vs.OutputChannel {
	if (!channels[name])
		return createChannel(name);

	return channels[name];
}

export function runProcessInChannel(process: SpawnedProcess, channel: vs.OutputChannel) {
	process.stdout.on("data", (data) => channel.append(data.toString()));
	process.stderr.on("data", (data) => channel.append(data.toString()));
	process.on("close", (code) => channel.appendLine(`exit code ${code}`));
}
