/// Simple time-base cache.
export class SimpleTimeBasedCache<T> {
	private data = new Map<string, CacheItem<T>>();

	public get(key: string): T | undefined {
		const item = this.data.get(key);

		if (item && item.expiryTime < new Date().getTime()) {
			this.data.delete(key);
			return undefined;
		}

		return item?.data;
	}

	public add(key: string, item: T, millisecondsToCache: number) {
		this.data.set(
			key,
			{
				data: item,
				expiryTime: new Date().getTime() + millisecondsToCache,
			},
		);
	}
}

interface CacheItem<T> {
	data: T;
	expiryTime: number;
}
