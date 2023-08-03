import { WebClient } from "../fetch";

export class PubApi {
	public readonly pubUrlBase: string;

	constructor(private readonly webClient: WebClient) {
		this.pubUrlBase = process.env.PUB_HOSTED_URL || "https://pub.dev";
	}

	public async getPackage(packageID: string): Promise<PubPackage> {
		return this.get<PubPackage>(`packages/${packageID}`);
	}

	public async getPackageNames(): Promise<PackageNameCompletionData> {
		return this.get<PackageNameCompletionData>(`package-name-completion-data`);
	}

	private async get<T>(url: string): Promise<T> {
		const headers = {
			"Accept": "application/vnd.pub.v2+json",
			"Accept-Encoding": "gzip",
		};
		const response = await this.webClient.fetch(`${this.pubUrlBase}/api/${url}`, headers);
		return JSON.parse(response) as T;
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
	retracted?: boolean,
	pubspec: {
		version: string;
		name: string;
		author: string;
		description: string;
		homepage: string;
	};
}

export interface PackageNameCompletionData {
	packages: string[];
}
