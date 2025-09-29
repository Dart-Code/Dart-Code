import { strict as assert } from "assert";
import { fsPath } from "../../shared/utils/fs";
import { flutterTestDeviceId } from "../debug_helpers";
import { activate, ensureArrayContainsArray, flutterHelloWorldFolder, flutterHelloWorldMainFile, flutterTestMainFile, getResolvedDebugConfiguration, setConfigForTest } from "../helpers";

describe(`flutter run debugger`, () => {
	beforeEach("activate helloWorldMainFile", () => activate(null));

	describe("resolves the correct debug config", () => {
		it("for a simple script", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				args: ["--foo"],
				deviceId: flutterTestDeviceId,
				program: fsPath(flutterHelloWorldMainFile),
			});

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.program, fsPath(flutterHelloWorldMainFile));
			assert.equal(resolvedConfig.cwd, fsPath(flutterHelloWorldFolder));
			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["-d", flutterTestDeviceId]);
			assert.equal(resolvedConfig.toolArgs!.includes("--web-server-debug-protocol"), false);
			assert.deepStrictEqual(resolvedConfig.args, ["--foo"]);
		});

		it("when using the web-server service", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				deviceId: "web-server",
				program: fsPath(flutterHelloWorldMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--web-server-debug-protocol", "ws"]);
			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--web-server-debug-injected-client-protocol", "ws"]);
		});

		it('when web renderer is set to "flutter-default"', async () => {
			await setConfigForTest("dart", "flutterWebRenderer", "flutter-default");
			const resolvedConfig = await getResolvedDebugConfiguration({
				deviceId: "web-server",
				program: fsPath(flutterHelloWorldMainFile),
			});

			assert.ok(
				!resolvedConfig.toolArgs!.includes("--web-renderer"),
				"By default, the `--web-renderer` argument should not be set",
			);
		});

		it("when web renderer is set", async () => {
			await setConfigForTest("dart", "flutterWebRenderer", "html");
			const resolvedConfig = await getResolvedDebugConfiguration({
				deviceId: "web-server",
				program: fsPath(flutterHelloWorldMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--web-renderer", "html"]);
		});

		it("when flutterMode is set", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				deviceId: flutterTestDeviceId,
				flutterMode: "release",
				program: fsPath(flutterHelloWorldMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--release"]);
		});

		it("when flutterPlatform is set", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				deviceId: flutterTestDeviceId,
				flutterPlatform: "android-arm",
				program: fsPath(flutterHelloWorldMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--target-platform", "android-arm"]);
		});

		it("when flutterRunAdditionalArgs is set", async () => {
			await setConfigForTest("dart", "flutterRunAdditionalArgs", ["--no-sound-null-safety"]);
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(flutterHelloWorldMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--no-sound-null-safety"]);
		});
	});
});

describe("flutter test debugger", () => {
	beforeEach("activate helloWorldMainFile", () => activate(null));

	describe("resolves the correct debug config", () => {
		it("for a simple script", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				args: ["--foo"],
				program: fsPath(flutterTestMainFile),
			});

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.program, fsPath(flutterTestMainFile));
			assert.equal(resolvedConfig.cwd, fsPath(flutterHelloWorldFolder));
			assert.deepStrictEqual(resolvedConfig.args, ["--foo"]);
		});

		it("when flutterTestAdditionalArgs is set", async () => {
			await setConfigForTest("dart", "flutterTestAdditionalArgs", ["--no-sound-null-safety"]);
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(flutterTestMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--no-sound-null-safety"]);
		});

		it("when suppressTestTimeouts is set", async () => {
			await setConfigForTest("dart", "suppressTestTimeouts", "always");
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(flutterTestMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--timeout"]);
		});
	});
});
