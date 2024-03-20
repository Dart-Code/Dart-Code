import { strict as assert } from "assert";
import * as vs from "vscode";
import { activate, extApi, sb } from "../../helpers";

describe("DevTools", async () => {
	beforeEach("activate", () => activate());

	function startFakeDebugSession() {
		// Set up a fake debug session.
		const debugSession = {
			configuration: {
				name: "Dart",
				request: "launch",
				type: "dart",
			},
			id: "fake-session",
			type: "dart",
		} as vs.DebugSession;
		extApi.debugCommands.handleDebugSessionStart(debugSession);
		return debugSession;
	}

	function assertDevToolsUriWithVmService(openedUri: string, expectedVmServiceUri: string) {
		const encodedVmServiceUri = encodeURIComponent(expectedVmServiceUri);
		assert.ok(
			openedUri.includes(encodedVmServiceUri),
			`URI did not contain expected VM Service!\nOpened: ${openedUri}\nExpected to contain: ${encodedVmServiceUri}`,
		);
	}

	it("opens with the correct VM Service in the URI", async () => {
		const debugSession = startFakeDebugSession();
		const debuggerUrisEvent = {
			vmServiceUri: "ws://fake-host:123/ws",
		};
		extApi.debugCommands.handleDebugSessionCustomEvent({
			body: debuggerUrisEvent,
			event: "dart.debuggerUris",
			session: debugSession,
		});

		// Stub out openInBrowser so we don't really open and can capture the arguments.
		const openBrowserCommand = sb.stub(extApi.envUtils, "openInBrowser").resolves();

		// Trigger opening DevTools.
		await vs.commands.executeCommand("dart.openDevTools.external");

		// Verify an attempt was made to open the correct URI.
		assert.equal(openBrowserCommand.calledOnce, true);
		const openedUri = openBrowserCommand.args[0][0] as string; // First invocation, first arg.
		assertDevToolsUriWithVmService(openedUri, debuggerUrisEvent.vmServiceUri);
	});
});

