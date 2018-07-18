
export function getLaunchConfig(noDebug: boolean, path: string, testName: string) {
	return {
		args: testName ? ["--plain-name", testName] : undefined,
		name: "Tests",
		noDebug,
		program: path,
		request: "launch",
		type: "dart",
	};
}
