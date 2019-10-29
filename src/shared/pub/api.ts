import { fetch } from "../../shared/fetch";

export class PubApi {
	public async getPackage(packageID: string): Promise<PubPackage> {
		return this.get<PubPackage>(`packages/${packageID}`);
	}

	private async get<T>(url: string): Promise<T> {
		const headers = {
			Accept: "application/vnd.pub.v2+json",
		};
		return JSON.parse(await fetch(`https://pub.dev/api/${url}`, headers)) as T;
	}
}

interface PubPackage {
	name: string;
	latest: PubPackageVersion;
	versions: PubPackageVersion[];
}

interface PubPackageVersion {
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
