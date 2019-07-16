const knownInfrastructureThreadPrefixes = ["pub.dart.snapshot", "test.dart.snapshot"] as const;

export function isKnownInfrastructureThread(thread: { name: string }): boolean {
	return !!(thread && thread.name && knownInfrastructureThreadPrefixes.find((p) => thread.name.startsWith(p)));
}
