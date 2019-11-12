import * as vs from "vscode";
import { PromiseCompleter } from "../../../shared/utils";
import { red, yellow } from "../../../shared/utils/colors";

export class DartDebugSessionInformation {
	public observatoryUri?: string;
	public vmServiceUri?: string;
	/// Reporting for the launch step.
	public readonly launchProgressPromise = new PromiseCompleter<void>();
	public launchProgressReporter?: vs.Progress<{ message?: string; increment?: number; }>; // Set to undefined when launch finishes as a signal.
	// Reporting for any operation that happens outside of launching.
	public progressPromise?: PromiseCompleter<void>;
	public progressReporter?: vs.Progress<{ message?: string; increment?: number; }>;
	public progressID?: string;
	public readonly sessionStart: Date = new Date();
	constructor(public readonly session: vs.DebugSession, public readonly debuggerType: string, public readonly terminal: DartDebugSessionPseudoterminal | undefined) { }
}

const spawnedTerminalsByName: { [key: string]: vs.Terminal } = {};
export class DartDebugSessionPseudoterminal {
	private readonly userInputEmitter = new vs.EventEmitter<string>();
	public readonly userInput = this.userInputEmitter.event;
	private readonly emitter = new vs.EventEmitter<string>();
	private readonly terminal: vs.Terminal;
	private readonly pseudoterminal: vs.Pseudoterminal;
	private isRunning = true;

	constructor(public readonly terminalName: string) {
		this.pseudoterminal = {
			close: () => { },  // TODO: End debug session!
			handleInput: (data) => {
				if (!this.isRunning)
					return;

				data = data === "\r" ? "\r\n" : data;
				this.addOutput(data, "userInput");
				this.userInputEmitter.fire(data);
			},
			onDidWrite: this.emitter.event,
			// tslint:disable-next-line: no-empty
			open: () => { },

		};
		// Close any existing terminal with the same name to ensure we're not creating
		// new ones each time.
		if (spawnedTerminalsByName[terminalName])
			spawnedTerminalsByName[terminalName].dispose();
		this.terminal = vs.window.createTerminal({ name: terminalName, pty: this.pseudoterminal });
		spawnedTerminalsByName[terminalName] = this.terminal;
		this.terminal.show();
	}

	public end() {
		// Used to stop echoing user input back once the process has terminated.
		this.isRunning = false;
	}

	public addOutput(output: string, category: string) {
		if (!output)
			return;

		// If we don't send \r's then VS Code's terminal will not reset
		// to column 0.
		output = output.replace(/\n/g, "\r\n");

		switch (category) {
			case "stderr":
				output = red(output);
				break;
			case "stdout":
			case "userInput":
				break;
			default:
				output = yellow(output);
				break;
		}

		this.emitter.fire(output);
	}
}
