"use strict";

import * as child_process from "child_process";
import * as vs from "vscode";

let channels: { [key: string]: vs.OutputChannel } = {};

export function createChannel(name: string): vs.OutputChannel {
    if (channels[name] == null)
        channels[name] = vs.window.createOutputChannel(name);
    else
        channels[name].clear();

    return channels[name];
}

export function getChannel(name: string): vs.OutputChannel {
    if (channels[name] == null)
        return createChannel(name);

    return channels[name];
}

export function runProcessInChannel(process: child_process.ChildProcess, channel: vs.OutputChannel) {
    process.stdout.on("data", (data) => channel.append(data));
    process.stderr.on("data", (data) => channel.append(data));
    process.on("close", (code) => channel.appendLine(`exit code ${code}`));
}
