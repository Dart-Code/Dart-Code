import { escapeRegExp } from "../../shared/utils";

export function getLaunchConfig(noDebug: boolean, path: string, testName: string, isGroup: boolean) {
	return {
		args: testName ? ["--name", makeRegexForTest(testName, isGroup)] : undefined,
		name: "Tests",
		noDebug,
		program: path,
		request: "launch",
		type: "dart",
	};
}

export function makeRegexForTest(name: string, isGroup: boolean) {
	const prefix = "^";
	const suffix = isGroup ? "" : "$";
	// Require exact match (though for group, allow anything afterwards).
	return prefix + escapeRegExp(name) + suffix;
}
