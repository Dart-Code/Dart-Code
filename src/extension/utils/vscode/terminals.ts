import * as vs from "vscode";

export function writeToPseudoTerminal(messages: string[]): [vs.Terminal, vs.EventEmitter<string>] {
	const emitter = new vs.EventEmitter<string>();
	const pseudoterminal: vs.Pseudoterminal = {
		close: () => { },
		onDidWrite: emitter.event,
		open: () => {
			for (const output of messages) {
				if (output)
					emitter.fire(formatForTerminal(output));
			}
		},
	};
	const currentTestTerminal: [vs.Terminal, vs.EventEmitter<string>] = [
		vs.window.createTerminal({ name: "Test Output", pty: pseudoterminal }),
		emitter,
	];
	currentTestTerminal[0].show();
	return currentTestTerminal;
}

export function formatForTerminal(output: string) {
	// For terminal, if we send \n without a \r the rendering will be bad.
	return output.replace(/\n/g, "\r\n").replace(/\r\r\n/g, "\r\n");
}
