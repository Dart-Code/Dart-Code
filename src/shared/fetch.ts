import * as http from "http";
import * as https from "https";
import * as url from "url";
import * as zlib from "zlib";

export class WebClient {
	private readonly userAgent: string;

	constructor(extensionVersion: string) {
		this.userAgent = `Dart-Code/${extensionVersion} (https://dartcode.org/)`;
	}

	// TODO: Move over things over to this...
	public fetch(urlString: string, headers?: http.OutgoingHttpHeaders) {
		const u = url.parse(urlString);
		if (u.protocol === "https:" && u.hostname)
			return this.fetchHttps(u.hostname, u.port || "443", u.path || "", headers);
		else if (u.protocol === "http:" && u.hostname)
			return this.fetchHttp(u.hostname, u.port || "80", u.path || "", headers);
		else
			throw new Error(`Cannot fetch URL ${urlString}`);
	}

	private fetchHttps(hostname: string | undefined, port: string | undefined, path: string | undefined, headers: http.OutgoingHttpHeaders = {}): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const options: https.RequestOptions = {
				headers: {
					...headers,
					"User-Agent": this.userAgent,
				},
				hostname,
				method: "GET",
				path,
				port,
			};

			const req = https.request(options, (resp) => {
				if (!resp || !resp.statusCode || resp.statusCode < 200 || resp.statusCode > 300) {
					reject({ message: `Failed to get ${path}: ${resp && resp.statusCode}: ${resp && resp.statusMessage}` });
				} else {
					const chunks: any[] = [];
					resp.on("data", (b) => chunks.push(b));
					resp.on("end", () => {
						const buffer = Buffer.concat(chunks);
						const encoding = resp.headers["content-encoding"];
						if (encoding === "gzip") {
							zlib.gunzip(buffer, (err, decoded) => {
								if (err)
									reject(err);
								else
									resolve(decoded?.toString());
							});
						} else {
							resolve(buffer.toString());
						}
					});
				}
			});
			req.end();
		});
	}

	private fetchHttp(hostname: string | undefined, port: string | undefined, path: string | undefined, headers: http.OutgoingHttpHeaders = {}): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const options: http.RequestOptions = {
				headers: {
					...headers,
					"User-Agent": this.userAgent,
				},
				hostname,
				method: "GET",
				path,
				port,
			};

			const req = http.request(options, (resp) => {
				if (!resp || !resp.statusCode || resp.statusCode < 200 || resp.statusCode > 300) {
					reject({ message: `Failed to get ${path}: ${resp && resp.statusCode}: ${resp && resp.statusMessage}` });
				} else {
					const chunks: string[] = [];
					resp.on("data", (b: Buffer | string) => chunks.push(b.toString()));
					resp.on("end", () => {
						const data = chunks.join("");
						resolve(data);
					});
				}
			});
			req.end();
		});
	}
}
