import { URI } from "vscode-uri";
import { uriComparisonString } from "./fs";

export class DocumentCache<T> {
	private readonly data = new Map<string, T>();

	public get(uri: URI): T | undefined {
		return this.data.get(this.key(uri));
	}

	public set(uri: URI, value: T): void {
		this.data.set(this.key(uri), value);
	}

	public has(uri: URI): boolean {
		return this.data.has(this.key(uri));
	}

	public delete(uri: URI): void {
		this.data.delete(this.key(uri));
	}

	public clear(): void {
		this.data.clear();
	}

	get size(): number {
		return this.data.size;
	}

	private key(uri: URI): string {
		return uriComparisonString(uri);
	}
}
