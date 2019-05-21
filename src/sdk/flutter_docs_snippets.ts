import * as fs from "fs";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import { FlutterCapabilities } from "../flutter/capabilities";
import { getRandomInt, Sdks } from "../utils";
import { tryDeleteFile } from "../utils/fs";
import { runProcess } from "../utils/processes";
import { flutterPath } from "./utils";

export interface FlutterSampleSnippet {
	readonly sourcePath: string;
	readonly sourceLine: number;
	readonly package: string;
	readonly library: string;
	readonly element: string;
	readonly id: string;
	readonly file: string;
	readonly description: string;
}

export function getFlutterSnippets(sdks: Sdks, capabilities: FlutterCapabilities): Promise<FlutterSampleSnippet[]> {
	if (capabilities.supportsFlutterCreateListSamples)
		return getFlutterSnippetsFromSdk(sdks);
	return getFlutterSnippetsFromWeb();
}

async function getFlutterSnippetsFromSdk(sdks: Sdks): Promise<FlutterSampleSnippet[]> {
	if (!sdks.flutter)
		throw new Error("Flutter SDK not available");

	const binPath = path.join(sdks.flutter, flutterPath);

	const fileName = `flutter-samples-${getRandomInt(0x1000, 0x10000).toString(16)}.txt`;
	const tempPath = path.join(os.tmpdir(), fileName);

	try {
		const res = await runProcess(undefined, binPath, ["create", "--list-samples", tempPath]);
		if (res.exitCode !== 0)
			throw new Error(`Failed to get Flutter samples from SDK (${res.exitCode})\n\n${res.stderr}\n\n${res.stdout}`);

		const json = fs.readFileSync(tempPath, { encoding: "utf8" });

		return JSON.parse(json);
	} finally {
		tryDeleteFile(tempPath);
	}
}

function getFlutterSnippetsFromWeb(): Promise<FlutterSampleSnippet[]> {
	return new Promise<FlutterSampleSnippet[]>((resolve, reject) => {
		const options: https.RequestOptions = {
			hostname: "api.flutter.dev",
			method: "GET",
			path: "/snippets/index.json",
			port: 443,
		};

		const req = https.request(options, (resp) => {
			if (!resp || !resp.statusCode || resp.statusCode < 200 || resp.statusCode > 300) {
				reject({ message: `Failed to get Flutter samples ${resp && resp.statusCode}: ${resp && resp.statusMessage}` });
			} else {
				const chunks: string[] = [];
				resp.on("data", (b) => chunks.push(b.toString()));
				resp.on("end", () => {
					const json = chunks.join("");
					resolve(JSON.parse(json));
				});
			}
		});
		req.end();
	});
}
