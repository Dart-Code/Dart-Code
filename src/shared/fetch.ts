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

			const req = https.request(options, (res) => this.handleResponse(headers, res, resolve, reject, path));
			req.end();
		});
	}

	private handleResponse(headers: http.OutgoingHttpHeaders, resp: http.IncomingMessage, resolve: (value: string | PromiseLike<string>) => void, reject: (reason?: any) => void, path: string | undefined): void {
		if (!resp || !resp.statusCode) {
			reject({ message: `Failed to get ${path}: ${resp && resp.statusMessage}` });
		} else if (resp.statusCode >= 301 && resp.statusCode <= 302) {
			const newLocation = resp.headers.location;
			if (!newLocation) {
				reject({ message: `Redirect with no 'location' header for ${path}: ${resp && resp.statusCode}: ${resp && resp.statusMessage}` });
			} else {
				resolve(this.fetch(newLocation, headers));
			}
		} else if (resp.statusCode < 200 || resp.statusCode > 300) {
			reject({ message: `Bad status code for ${path}: ${resp && resp.statusCode}: ${resp && resp.statusMessage}` });
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

			const req = http.request(options, (res) => this.handleResponse(headers, res, resolve, reject, path));
			req.end();
		});
	}
}

