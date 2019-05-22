export function sortBy<T>(items: T[], f: (item: T) => any): T[] {
	return items.sort((item1, item2) => {
		const r1 = f(item1);
		const r2 = f(item2);
		if (r1 < r2) return -1;
		if (r1 > r2) return 1;
		return 0;
	});
}

export function not(f: (x: any) => boolean): (x: any) => boolean {
	return (x) => !f(x);
}
