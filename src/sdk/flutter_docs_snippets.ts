import * as https from "https";
import { config } from "../config";

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

export function getFlutterSnippets(): Promise<FlutterSampleSnippet[]> {
	return new Promise<FlutterSampleSnippet[]>((resolve, reject) => {
		if (!config.flutterDocsHost)
			reject("No Flutter docs host set");
		const options: https.RequestOptions = {
			hostname: config.flutterDocsHost,
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
