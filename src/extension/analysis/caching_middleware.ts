import * as vs from "vscode";
import { ClientCapabilities, FeatureState, LanguageClient, ProvideDocumentSymbolsSignature, StaticFeature } from "vscode-languageclient/node";
import { IAmDisposable } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { VersionedDocumentCache } from "../../shared/vscode/document_cache";

type DocumentSymbolsResult = vs.SymbolInformation[] | vs.DocumentSymbol[] | null | undefined;

interface InFlightDocumentSymbols {
	promise: Promise<DocumentSymbolsResult>;
	tokenSource?: CompositeCancellationTokenSource;
}

/**
 * Middleware feature that caches LSP responses where appropriate to avoid duplicate requests
 * to the server (such as when VS Code fires multiple concurrent `documentSymbol` requests for the
 * same document version).
 */
export class CachingMiddlewareFeature implements StaticFeature, IAmDisposable {
	private readonly disposables: IAmDisposable[] = [];
	private readonly documentSymbols = new VersionedDocumentCache<InFlightDocumentSymbols>();

	constructor(private readonly client: LanguageClient) {
		this.disposables.push(this.documentSymbols);
		this.addMiddleware();
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
		if (document.isClosed || token.isCancellationRequested)
			return Promise.resolve(next(document, token));

		const existing = this.documentSymbols.get(document);
		if (existing) {
			existing.tokenSource?.addToken(token);
			return existing.promise;
		}

		const version = document.version;
		const tokenSource = new CompositeCancellationTokenSource(token);
		let shouldKeepInCache = false;
		const entry: InFlightDocumentSymbols = {
			tokenSource,
			promise: Promise.resolve(next(document, tokenSource.token)).then(
				(result) => {
					shouldKeepInCache = !document.isClosed
						&& document.version === version
						&& !tokenSource.token.isCancellationRequested
						&& !!result;
					return result;
				},
			).finally(() => {
				entry.tokenSource = undefined;
				tokenSource.dispose();
				if (!shouldKeepInCache)
					this.documentSymbols.deleteIfSame(document, entry);
			}),
		};

		this.documentSymbols.set(document, entry);
		return entry.promise;
	}

	public dispose(): void {
		this.clear();
		disposeAll(this.disposables);
	}
}

/**
 * Wraps a `CancellationTokenSource` that only cancels once all attached `CancellationToken`s
 * have been cancelled.
 */
class CompositeCancellationTokenSource implements IAmDisposable {
	private readonly tokenSource = new vs.CancellationTokenSource();
	private readonly disposables: IAmDisposable[] = [];
	private readonly tokens: vs.CancellationToken[] = [];
	private isDisposed = false;

	constructor(initialToken: vs.CancellationToken) {
		this.disposables.push(this.tokenSource);
		this.addToken(initialToken);
	}

	public get token(): vs.CancellationToken {
		return this.tokenSource.token;
	}

	public addToken(token: vs.CancellationToken): void {
		if (this.isDisposed || this.tokenSource.token.isCancellationRequested)
			return;

		this.tokens.push(token);
		if (token.isCancellationRequested) {
			this.checkCancellation();
		} else {
			this.disposables.push(token.onCancellationRequested(() => this.checkCancellation()));
		}
	}

	private checkCancellation(): void {
		if (!this.isDisposed && this.tokens.length > 0 && this.tokens.every((t) => t.isCancellationRequested))
			this.tokenSource.cancel();
	}

	public dispose(): void {
		this.isDisposed = true;
		this.tokens.length = 0;
		disposeAll(this.disposables);
	}
}
