import * as vs from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { IAmDisposable } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { DebugCommands } from "../commands/debug";
import { DartCodeApi, DartCodeDebugApi, DartCodeExports, DartCodeLanguageApi, DartDebugSessionEndedEvent, DartDebugSessionStartedEvent, DartDebugSessionStartingEvent } from "./interface";

export class DartExtensionApi implements DartCodeExports {
	public readonly version = 2;
	public flutterCreateSampleProject = () => vs.commands.executeCommand("_dart.flutter.createSampleProject");
	public getExtensionApi = async (extensionName: string) => new ExtensionApi(extensionName, this.debugCommands, this.client);

	constructor(private readonly debugCommands: DebugCommands, private readonly client: LanguageClient | undefined) { }
}

class ExtensionApi implements DartCodeApi {
	protected disposables: IAmDisposable[] = [];
	public readonly debug: DartCodeDebugApi;
	public readonly language: DartCodeLanguageApi | undefined;
	constructor(public readonly extensionName: string, debugCommands: DebugCommands, lspClient: LanguageClient | undefined) {
		this.disposables.push(this.debug = new DebugApi(debugCommands));
		if (lspClient)
			this.disposables.push(this.language = new LanguageApi(lspClient));
	}

	public dispose(): void | Promise<void> {
		disposeAll(this.disposables);
	}
}

class DebugApi implements DartCodeDebugApi {
	protected disposables: IAmDisposable[] = [];

	private onSessionStartingEmitter = new vs.EventEmitter<DartDebugSessionStartingEvent>();
	public readonly onSessionStarting = this.onSessionStartingEmitter.event;
	private onSessionStartedEmitter = new vs.EventEmitter<DartDebugSessionStartedEvent>();
	public readonly onSessionStarted = this.onSessionStartedEmitter.event;
	private onSessionEndedEmitter = new vs.EventEmitter<DartDebugSessionEndedEvent>();
	public readonly onSessionEnded = this.onSessionEndedEmitter.event;

	constructor(private readonly debugCommands: DebugCommands) {
		this.disposables.push(vs.debug.onDidStartDebugSession((e) => {
			if (e.type !== "dart")
				return;

			this.onSessionStartingEmitter.fire({
				configuration: e.configuration,
				id: e.id,
			});
		}));
		this.disposables.push(vs.debug.onDidTerminateDebugSession((e) => {
			if (e.type !== "dart")
				return;

			this.onSessionEndedEmitter.fire({ id: e.id });
		}));
		this.disposables.push(this.debugCommands.onDebugSessionVmServiceAvailable((session) => {
			// TODO(dantup): Ensure consistent format... ws://127.0.0.1:123/TOKEN/ws ? without /ws ?
			this.onSessionStartedEmitter.fire({
				id: session.session.id,
				vmService: session.vmServiceUri,
			});
		}));
	}

	public dispose(): void | Promise<void> {
		disposeAll(this.disposables);
	}
}


class LanguageApi implements DartCodeLanguageApi {
	protected disposables: IAmDisposable[] = [];

	constructor(private readonly lspClient: LanguageClient) { }

	public rawRequest(method: string, params: unknown): Promise<unknown> {
		// TODO(dantup): Whitelist what we allow here. We certainly shouldn't allow
		//  things like modifying the overlays or analysis roots.
		return this.lspClient.sendRequest(method, params);
	}

	public dispose(): void | Promise<void> {
		disposeAll(this.disposables);
	}
}
