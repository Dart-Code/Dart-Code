const knownInfrastructureThreadPrefixes = ["pub.dart.snapshot", "test.dart.snapshot"] as const;

export function isKnownInfrastructureThread(thread: { name: string }) {
	return thread && thread.name && !!knownInfrastructureThreadPrefixes.find((p) => thread.name.startsWith(p));
}
