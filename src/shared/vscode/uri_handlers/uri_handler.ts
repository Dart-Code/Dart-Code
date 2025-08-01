import * as vs from "vscode";
import { FlutterCapabilities } from "../../capabilities/flutter";
import { FlutterSampleUriHandler } from "./flutter_sample_handler";

export class DartUriHandler implements vs.UriHandler {
	private readonly handlers: Record<string, { handle: (path: string) => void | Promise<void> }>;
	public constructor(flutterCapabilities: FlutterCapabilities) {
		this.handlers = {
			"/flutter/sample/": new FlutterSampleUriHandler(flutterCapabilities),
		};
	}

	public async handleUri(uri: vs.Uri): Promise<void> {
		const handlerPrefix = Object.keys(this.handlers).find((key) => uri.path.startsWith(key));
		if (handlerPrefix) {
			await this.handlers[handlerPrefix].handle(uri.path.substr(handlerPrefix.length));
		} else {
			void vs.window.showErrorMessage(`No handler for '${uri.path}'. Check you have the latest version of the Dart plugin and try again.`);
		}
	}
}
