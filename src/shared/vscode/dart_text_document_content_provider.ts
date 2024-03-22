import { Uri, workspace } from "vscode";
import { ClientCapabilities, DocumentUri, FeatureState, NotificationType, RequestType, StaticFeature } from "vscode-languageclient";
import { LanguageClient } from "vscode-languageclient/node";
import { DartCapabilities } from "../capabilities/dart";
import { EventEmitter } from "../events";
import { IAmDisposable, Logger } from "../interfaces";
import { disposeAll } from "../utils";


export class DartTextDocumentContentProviderFeature implements IAmDisposable {
	private disposables: IAmDisposable[] = [];

	constructor(private readonly logger: Logger, private readonly client: LanguageClient, private readonly dartCapabilities: DartCapabilities) {
	}

	public get feature(): StaticFeature {
		const client = this.client;
		const dartCapabilities = this.dartCapabilities;
		const disposables = this.disposables;
		return {
			dispose() {
				disposeAll(disposables);
			},
			fillClientCapabilities(capabilities: ClientCapabilities) {
				capabilities.experimental ??= {};
				capabilities.experimental.supportsDartTextDocumentContentProvider = true;
				// TODO(dantup): Remove this legacy flag sometime after April 2024 as it was
				//  just for during dev in case the API needed to change (it did not).
				capabilities.experimental.supportsDartTextDocumentContentProviderEXP1 = true;
			},
			getState(): FeatureState {
				return { kind: "static" };
			},
			initialize(serverCapabilities) {
				const provider = serverCapabilities.experimental?.dartTextDocumentContentProvider as DartTextDocumentContentProviderRegistrationOptions | undefined;
				// Just because we're enabled does not mean the server necessarily supports it.
				if (provider?.schemes) {
					const didChangeEmitter = new EventEmitter<Uri>();
					disposables.push(client.onNotification(DartTextDocumentContentDidChangeNotification.type, (n) => {
						const uri = client.protocol2CodeConverter.asUri(n.uri);
						didChangeEmitter.fire(uri);
					}));

					for (const scheme of provider?.schemes) {
						const didChangeSchemeEmitter = new EventEmitter<Uri>();
						disposables.push(didChangeEmitter.listen((uri) => {
							if (uri.scheme.toLowerCase() === scheme.toLowerCase()) {
								didChangeSchemeEmitter.fire(uri);
							}
						}));
						disposables.push(workspace.registerTextDocumentContentProvider(scheme, {
							async provideTextDocumentContent(uri, token) {
								const result = await client.sendRequest(
									DartTextDocumentContentProviderRequest.type,
									{ uri: client.code2ProtocolConverter.asUri(uri) },
									token
								);
								return result?.content;
							},
							onDidChange: didChangeSchemeEmitter.event,
						}));
					}
				}
			},
		};
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

class DartTextDocumentContentProviderRequest {
	public static type = new RequestType<DartTextDocumentContentParams, DartTextDocumentContent, void>("dart/textDocumentContent");
}

interface DartTextDocumentContentParams {
	uri: DocumentUri;
}

interface DartTextDocumentContent {
	content?: string;
}

interface DartTextDocumentContentProviderRegistrationOptions {
	schemes: string[];
}

class DartTextDocumentContentDidChangeNotification {
	public static type = new NotificationType<DartTextDocumentContentDidChangeParams>("dart/textDocumentContentDidChange");
}

interface DartTextDocumentContentDidChangeParams {
	uri: DocumentUri;
}
