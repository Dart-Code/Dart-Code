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

export function unique<T>(items: T[]): T[] {
	return Array.from(new Set(items));
}

export function arraysEqual<T>(items1: T[], items2: T[]) {
	return items1.length === items2.length && items1.every((val, i) => val === items2[i]);
}

export function arrayStartsWith<T>(items1: T[], items2: T[]) {
	return items1.length >= items2.length && arraysEqual(items1.slice(0, items2.length), items2);
}

export function arrayContainsArray<T>(haystack: T[], needle: T[]): boolean {
	// Loop over valid starting points for the subarray
	for (let i = 0; i <= haystack.length - needle.length; i++) {
		// Check if the relevant length sublist equals the other array.
		if (arraysEqual(haystack.slice(i, i + needle.length), needle))
			return true;
	}
	return false;
}
