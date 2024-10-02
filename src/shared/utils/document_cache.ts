import { URI } from "vscode-uri";
import { uriComparisonString } from "./fs";

export class DocumentCache<T> {
	private readonly data = new Map<string, T>();

	public get(uri: URI): T | undefined {
		return this.data.get(this.key(uri));
	}

	public getForPath(filePath: string): T | undefined {
		return this.get(URI.file(filePath));
	}

	public set(uri: URI, value: T): void {
		this.data.set(this.key(uri), value);
	}

	public setForPath(filePath: string, value: T): void {
		this.set(URI.file(filePath), value);
	}

	public has(uri: URI): boolean {
		return this.data.has(this.key(uri));
	}

	public hasForPath(filePath: string): boolean {
		return this.has(URI.file(filePath));
	}

	public delete(uri: URI): void {
		this.data.delete(this.key(uri));
	}

	public deleteForPath(filePath: string): void {
		this.delete(URI.file(filePath));
	}

	public clear(): void {
		this.data.clear();
	}

	public get size(): number {
		return this.data.size;
	}

	public values(): IterableIterator<T> {
		return this.data.values();
	}

	private key(uri: URI): string {
		return uriComparisonString(uri);
	}
}
