import * as vs from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { DebugCommands } from "./commands/debug";

export class DartExtensionApi {
	public readonly version = 2;
	public flutterCreateSampleProject = () => vs.commands.executeCommand("_dart.flutter.createSampleProject");
	public getExtensionApi = async (extensionName: string) => new ExtensionApi(extensionName, this.debugCommands, this.client);

	constructor(private readonly debugCommands: DebugCommands, private readonly client: LanguageClient | undefined) { }
}

class ExtensionApi {
	constructor(public readonly extensionName: string, private readonly debugCommands: DebugCommands, private readonly client: LanguageClient | undefined) {
		// TODO(dantup): disposable for all of these...
		vs.debug.onDidStartDebugSession((e) => {
			if (e.type !== "dart")
				return;

			this._sendEvent(
				"debugSession.starting",
				{
					configuration: e.configuration,
					id: e.id,
				},
			);
		});
		vs.debug.onDidTerminateDebugSession((e) => {
			if (e.type !== "dart")
				return;

			this._sendEvent("debugSession.ended", { id: e.id });
		});
		this.debugCommands.onDebugSessionVmServiceAvailable((session) => {
			if (session.vmServiceUri) {
				// TODO(dantup): Ensure consistent format... ws://127.0.0.1:123/TOKEN/ws ? without /ws ?
				this._sendEvent(
					"debugSession.started",
					{
						id: session.session.id,
						vmService: session.vmServiceUri,
					},
				);
			}
		});
	}

	public async handleMessageFromExtension(message: any) {
		console.warn(`WebView => Dart-Code: ${JSON.stringify(message)}`);
		const payload = message?.payload;
		const id = payload?.id as number | undefined;
		const method = payload?.method as string | undefined;
		const params = payload?.params;
		const result = payload?.result;
		const error = payload?.error;

		if (!id) return;

		if (method) {
			try {
				const result = await this._handleRequest(method, params);
				this._sendResultResponse(id, result);
			} catch (e) {
				this._sendErrorResponse(id, error);
			}
		} else if (result) {
			// complete
		} else if (error) {
			// complete error
		} else {
			//  ???
		}
	}

	private _sendResultResponse(id: number, result: unknown) {
		this._sendRaw({ id, result });
	}

	private _sendErrorResponse(id: number, error: unknown) {
		this._sendRaw({ id, error });
	}

	private _sendEvent(event: string, params: unknown) {
		this._sendRaw({ id: this._nextOutgoingId++, event, params });
	}

	private _nextOutgoingId = 1;

	private async _sendRaw(payload: unknown): Promise<void> {
		console.warn(`sending ${JSON.stringify(payload)}`);
		this.onDidReceiveMessageEmitter.fire({ direction: "HOST_TO_WEBVIEW", payload });
	}

	private async _handleRequest(method: string, rawParams: any): Promise<unknown> {
		switch (method) {
			case "executeCommand": {
				const params = rawParams as { command: string, args?: unknown[] };
				return await vs.commands.executeCommand(params.command, ...params.args ? params.args : []);
			}
			case "lspRequest": {
				if (!this.client) {
					throw new Error(`The Dart extension is running with the legacy protocol so LSP is not available`);
				}
				const params = rawParams as { method: string, params: unknown };
				return await this.client.sendRequest(params.method, params.params);
			}
			default:
				throw new Error(`Unsupported method: ${method}`);
		}
	}

	private onDidReceiveMessageEmitter = new vs.EventEmitter<any>();
	public readonly onDidReceiveMessage = this.onDidReceiveMessageEmitter.event;
}
