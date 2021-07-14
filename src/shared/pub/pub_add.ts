export class PackageDetailsCache {
	static cacheVersion = 1;
	static maxCacheAgeHours = 18;
	static get maxCacheAgeMs() { return PackageDetailsCache.maxCacheAgeHours * 60 * 60 * 1000; }
	static maxPackageDetailsRequestsInFlight = 5;

	constructor(
		private readonly lastUpdated: number,
		private readonly packages: Map<string, string | undefined>,
	) { }

	static fromPackageNames(packages: string[]): PackageDetailsCache {
		const packageMap = new Map<string, string | undefined>();
		packages.forEach((p) => packageMap.set(p, undefined));
		return new PackageDetailsCache(
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
		const timeRemainingMs = PackageDetailsCache.maxCacheAgeMs - ageMs;
		return timeRemainingMs < 0
			? 0
			: timeRemainingMs;
	}

	static fromJson(json: string): PackageDetailsCache | undefined {
		const data = JSON.parse(json, PackageDetailsCache.mapReviver);

		if (data.version !== PackageDetailsCache.cacheVersion)
			return undefined;

		return new PackageDetailsCache(
			data.lastUpdated,
			data.packages,
		);
	}

	public toJson(): string {
		return JSON.stringify(
			{
				lastUpdated: this.lastUpdated,
				packages: this.packages,
				version: PackageDetailsCache.cacheVersion,
			},
			PackageDetailsCache.mapReplacer,
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
			? new Map(value.value)
			: value;
	}
}
