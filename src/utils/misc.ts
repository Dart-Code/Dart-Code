export type NullAsUndefined<T> = T extends null ? Exclude<T, null> | undefined : T;

export function nullToUndefined<T>(value: T): NullAsUndefined<T> {
	return (value === null ? undefined : value) as NullAsUndefined<T>;
}
