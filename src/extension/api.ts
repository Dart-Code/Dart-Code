import * as vs from "vscode";

export class DartExtensionApi {
	public readonly version = 2;
	public flutterCreateSampleProject = () => vs.commands.executeCommand("_dart.flutter.createSampleProject");
	public getExtensionApi = async (extensionName: string) => new ExtensionApi(extensionName);
}

class ExtensionApi {
	constructor(public readonly extensionName: string) {
		setInterval(() => this.onDidReceiveMessageEmitter.fire({ direction: "HOST_TO_WEBVIEW", message: "Foo" }), 5000);
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

	private async _sendRaw(payload: unknown): Promise<void> {
		this.onDidReceiveMessageEmitter.fire({ direction: "HOST_TO_WEBVIEW", payload });
	}

	private async _handleRequest(method: string, rawParams: any): Promise<unknown> {
		const params = rawParams as { command: string, args?: unknown[] };
		switch (method) {
			case "executeCommand":
				return await vs.commands.executeCommand(params.command, ...params.args ? params.args : []);
				break;
			default:
				throw new Error(`Unsupported method: ${method}`);
		}
	}

	private onDidReceiveMessageEmitter = new vs.EventEmitter<any>();
	public readonly onDidReceiveMessage = this.onDidReceiveMessageEmitter.event;
}
