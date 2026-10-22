import * as vs from "vscode";
import { CancellationToken, ClientCapabilities, FeatureState, LanguageClient, ProvideDocumentSymbolsSignature, StaticFeature } from "vscode-languageclient/node";
import { IAmDisposable } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { DocumentCache } from "../../shared/utils/document_cache";

type DocumentSymbolsResult = vs.SymbolInformation[] | vs.DocumentSymbol[] | null | undefined;

interface CachedDocumentSymbols {
	version: number;
	promise: Promise<DocumentSymbolsResult>;
}

/**
 * Middleware feature that caches LSP responses where appropriate to avoid duplicate requests
 * to the server (such as when VS Code fires multiple concurrent `documentSymbol` requests for the
 * same document version).
 */
export class CachingMiddlewareFeature implements StaticFeature, IAmDisposable {
	private readonly disposables: IAmDisposable[] = [];
	private readonly documentSymbols = new DocumentCache<CachedDocumentSymbols>();

	constructor(private readonly client: LanguageClient) {
		this.addMiddleware();

		this.disposables.push(
			vs.workspace.onDidCloseTextDocument((doc) => {
				this.documentSymbols.delete(doc.uri);
			}),
			vs.workspace.onDidChangeTextDocument((e) => {
				const cached = this.documentSymbols.get(e.document.uri);
				if (cached && cached.version !== e.document.version)
					this.documentSymbols.delete(e.document.uri);
			}),
		);
	}

	public fillClientCapabilities(_capabilities: ClientCapabilities): void { }

	public initialize(): void { }

	public getState(): FeatureState {
		return { kind: "static" };
	}

	public clear(): void {
		this.documentSymbols.clear();
	}

	private addMiddleware() {
		const middleware = this.client.clientOptions.middleware ??= {};

		const originalProvideDocumentSymbols = middleware.provideDocumentSymbols;
		middleware.provideDocumentSymbols = (document: vs.TextDocument, token: vs.CancellationToken, next: ProvideDocumentSymbolsSignature) => {
			const callNext: ProvideDocumentSymbolsSignature = (doc, tok) =>
				originalProvideDocumentSymbols
					? originalProvideDocumentSymbols(doc, tok, next)
					: next(doc, tok);

			return this.provideDocumentSymbols(document, token, callNext);
		};
	}

	private provideDocumentSymbols(
		document: vs.TextDocument,
		token: vs.CancellationToken,
		next: ProvideDocumentSymbolsSignature,
	): Promise<DocumentSymbolsResult> {
		if (document.isClosed)
			return Promise.resolve(next(document, token));

		const uri = document.uri;
		const version = document.version;

		const existing = this.documentSymbols.get(uri);
		if (existing?.version === version)
			return existing.promise;

		// Use a non-cancelling token for the underlying request so that if one caller cancels
		// its token, other concurrent callers (or future callers for the same version) still get
		// the results.
		const promise = Promise.resolve(next(document, CancellationToken.None)).then(
			(result) => {
				// If the document was closed or modified while the request was in-flight, or if
				// no results were returned (e.g. null/undefined), do not keep it in the cache.
				if (document.isClosed || document.version !== version || !result) {
					if (this.documentSymbols.get(uri)?.promise === promise)
						this.documentSymbols.delete(uri);
				}
				return result;
			},
			(error) => {
				if (this.documentSymbols.get(uri)?.promise === promise)
					this.documentSymbols.delete(uri);
				throw error;
			},
		);

		this.documentSymbols.set(uri, { version, promise });
		return promise;
	}

	public dispose(): void {
		this.clear();
		disposeAll(this.disposables);
	}
}
