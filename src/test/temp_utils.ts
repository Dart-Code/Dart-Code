import * as fs from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { URI } from "vscode-uri";
import { fsPath } from "../shared/utils/fs";

export function getRandomTempFolder(): string {
	const r = Math.floor(Math.random() * 100000);
	const base = path.join(tmpdir(), "dart-code-tests");
	if (!fs.existsSync(base))
		fs.mkdirSync(base);
	const tmpPath = path.join(base, r.toString());
	if (!fs.existsSync(tmpPath))
		fs.mkdirSync(tmpPath);
	return tmpPath;
}

export function tryDelete(item: string | URI) {
	if (typeof item !== "string") {
		if (item.scheme !== "file")
			return;
		else
			item = fsPath(item);
	}
	try {
		fs.rmSync(item,
			{
				force: true,
				recursive: true,
				// Sometimes Windows can take a while to let us delete.
				maxRetries: 10,
				retryDelay: 500
			});
	} catch (e) {
		console.warn(`Failed to clean up folder ${item}: ${String(e)}`);
	}
}
