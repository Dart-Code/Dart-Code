export function parseNumber(input: string): number {
	return input.toLowerCase().startsWith("0x")
		? parseInt(input.substring(2), 16)
		: parseInt(input, 10);
}
