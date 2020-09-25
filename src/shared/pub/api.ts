import { WebClient } from "../fetch";

export class PubApi {
	private readonly pubHost: string;
	constructor(private readonly webClient: WebClient) {
		this.pubHost = process.env.PUB_HOSTED_URL || "https://pub.dev";
	}

	public async getPackage(packageID: string): Promise<PubPackage> {
		return this.get<PubPackage>(`packages/${packageID}`);
	}

	private async get<T>(url: string): Promise<T> {
		const headers = {
			Accept: "application/vnd.pub.v2+json",
		};
		return JSON.parse(await this.webClient.fetch(`${this.pubHost}/api/${url}`, headers)) as T;
	}
}

interface PubPackage {
	name: string;
	latest: PubPackageVersion;
	versions: PubPackageVersion[];
}

interface PubPackageVersion {
	// eslint-disable-next-line camelcase
	archive_url: string;
	version: string;
	pubspec: {
		version: string;
		name: string;
		author: string;
		description: string;
		homepage: string;
	};
}
