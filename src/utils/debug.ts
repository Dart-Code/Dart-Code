export function extractObservatoryPort(observatoryUri: string): number | undefined {
	const matches = /:([0-9]+)\/?$/.exec(observatoryUri);
	return matches ? parseInt(matches[1], 10) : undefined;
}
