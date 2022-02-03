export class PackageCacheData {
	static cacheVersion = 1;
	static maxCacheAgeHours = 18;
	static get maxCacheAgeMs() { return PackageCacheData.maxCacheAgeHours * 60 * 60 * 1000; }
	static maxPackageDetailsRequestsInFlight = 5;

	constructor(
		private readonly lastUpdated: number,
		private readonly packages: Map<string, string | undefined>,
	) { }

	static fromPackageNames(packages: string[]): PackageCacheData {
		const packageMap = new Map<string, string | undefined>();
		packages.forEach((p) => packageMap.set(p, undefined));
		return new PackageCacheData(
			new Date().getTime(),
			packageMap,
		);
	}

	public get packageNames() {
		// TODO: Can we avoid this and just iterate in the callee, since we often
		// bail out early?
		return Array.from(this.packages.keys());
	}

	public get cacheTimeRemainingMs() {
		const ageMs = new Date().getTime() - this.lastUpdated;
		const timeRemainingMs = PackageCacheData.maxCacheAgeMs - ageMs;
		return timeRemainingMs < 0
			? 0
			: timeRemainingMs;
	}

	static fromJson(json: string): PackageCacheData | undefined {
		const data = JSON.parse(json, PackageCacheData.mapReviver) as PackageCache;

		if (data.version !== PackageCacheData.cacheVersion)
			return undefined;

		return new PackageCacheData(
			data.lastUpdated,
			data.packages,
		);
	}

	public toJson(): string {
		return JSON.stringify(
			{
				lastUpdated: this.lastUpdated,
				packages: this.packages,
				version: PackageCacheData.cacheVersion,
			} as PackageCache,
			PackageCacheData.mapReplacer,
			2,
		);
	}

	private static mapReplacer(key: unknown, value: unknown) {
		return value instanceof Map
			? {
				dataType: "Map",
				value: [...value],
			}
			: value;
	}

	private static mapReviver(key: unknown, value: any): unknown {
		return typeof value === "object" && value?.dataType === "Map"
			? new Map(value.value) // eslint-disable-line @typescript-eslint/no-unsafe-argument
			: value;
	}
}


interface PackageCache {
	lastUpdated: number;
	packages: Map<string, string | undefined>;
	version: number;
}
