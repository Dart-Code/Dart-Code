import { TextDocument, workspace } from "vscode";
import { IAmDisposable } from "../interfaces";
import { disposeAll } from "../utils";
import { DocumentCache } from "../utils/document_cache";

interface VersionedValue<T> {
	version: number;
	value: T;
}

/**
 * A cache of values keyed by document and version that automatically evicts entries
 * when documents are modified or closed.
 */
export class VersionedDocumentCache<T> implements IAmDisposable {
	private readonly disposables: IAmDisposable[] = [];
	private readonly cache = new DocumentCache<VersionedValue<T>>();

	constructor() {
		this.disposables.push(
			workspace.onDidCloseTextDocument((doc) => {
				this.cache.delete(doc.uri);
			}),
			workspace.onDidChangeTextDocument((e) => {
				const cached = this.cache.get(e.document.uri);
				if (cached && cached.version !== e.document.version)
					this.cache.delete(e.document.uri);
			}),
		);
	}

	public get(document: TextDocument): T | undefined {
		const cached = this.cache.get(document.uri);
		return cached?.version === document.version ? cached.value : undefined;
	}

	public set(document: TextDocument, value: T): void {
		this.cache.set(document.uri, { version: document.version, value });
	}

	public has(document: TextDocument): boolean {
		const cached = this.cache.get(document.uri);
		return cached?.version === document.version;
	}

	public delete(document: TextDocument): void {
		this.cache.delete(document.uri);
	}

	public deleteIfSame(document: TextDocument, value: T): void {
		if (this.cache.get(document.uri)?.value === value)
			this.cache.delete(document.uri);
	}

	public clear(): void {
		this.cache.clear();
	}

	public dispose(): void {
		this.clear();
		disposeAll(this.disposables);
	}
}
