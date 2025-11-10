import { strict as assert } from "assert";
import { DebuggerType } from "../../../shared/enums";
import { ServiceMethod } from "../../../shared/services/tooling_daemon_services";
import { fsPath } from "../../../shared/utils/fs";
import { createDebugClient, startDebugger } from "../../debug_helpers";
import { activateWithoutAnalysis, delay, helloWorldMainFile, positionOf, privateApi } from "../../helpers";

// These are debug-related tests for DTD. There are also some tests in `../dart`.
describe("dart tooling daemon", () => {
	beforeEach("activate helloWorldMainFile", () => activateWithoutAnalysis(helloWorldMainFile));

	beforeEach("skip if not supported", async function () {
		if (!privateApi.dartCapabilities.supportsToolingDaemon)
			this.skip();
	});

	it("should register and unregister VM Services", async function () {
		if (!privateApi.dartCapabilities.supportsDtdRegisterVmService)
			this.skip();

		const daemon = privateApi.toolingDaemon;
		assert.ok(daemon);

		// Wait for daemon to be up.
		await daemon.connected;
		await delay(50);

		// Ensure we don't have any existing sessions.
		assert.equal(privateApi.debugSessions.length, 0);

		// Ensure DTD also doesn't have any existing sessions.
		let vmServiceResponse = await daemon.callMethod(ServiceMethod.getVmServices);
		assert.deepStrictEqual(vmServiceResponse.vmServices, []);

		// Start a debug session.
		const dc = createDebugClient(DebuggerType.Dart);
		const sessionName = "My Test Session";
		const config = await startDebugger(dc, helloWorldMainFile, { name: sessionName });
		await dc.hitBreakpoint(config, { // Stop at a breakpoint so the app won't quit while we're verifying.
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldMainFile),
		});

		// Ensure we have a session with a URI.
		const session = privateApi.debugSessions[privateApi.debugSessions.length - 1];
		assert.ok(session.vmServiceUri);

		// Ensure DTD has the VM Service URI.
		vmServiceResponse = await daemon.callMethod(ServiceMethod.getVmServices);
		assert.deepStrictEqual(vmServiceResponse.vmServices, [{ name: sessionName, uri: session.vmServiceUri }]);

		// Stop the debug session.
		await Promise.all([
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		]);

		// Ensure our session is gone.
		assert.equal(privateApi.debugSessions.length, 0);

		// Ensure DTDs session is gone.
		vmServiceResponse = await daemon.callMethod(ServiceMethod.getVmServices);
		assert.deepStrictEqual(vmServiceResponse.vmServices, []);
	});
});
