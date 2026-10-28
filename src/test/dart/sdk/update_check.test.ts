import { strict as assert } from "assert";
import * as http from "http";
import * as sinon from "sinon";
import * as vs from "vscode";
import { config } from "../../../extension/config";
import { checkForStandardDartSdkUpdates } from "../../../extension/sdk/update_check";
import { getLatestSdkVersion } from "../../../extension/utils";
import { DART_DOWNLOAD_URL } from "../../../shared/constants";
import { WebClient } from "../../../shared/fetch";
import { Logger } from "../../../shared/interfaces";
import { envUtils } from "../../../shared/vscode/utils";
import { WorkspaceContext } from "../../../shared/workspace";
import { sb } from "../../helpers";

describe("update_check", () => {
	let logger: Logger & { error: sinon.SinonStub };
	let webClient: WebClient;
	let fetchStub: sinon.SinonStub;
	let showWarningMessage: sinon.SinonStub;
	let openInBrowser: sinon.SinonStub;
	let setCheckForSdkUpdates: sinon.SinonStub;

	beforeEach(() => {
		logger = {
			error: sb.stub(),
			info: sb.stub(),
			warn: sb.stub(),
		};
		webClient = new WebClient("1.0.0");
		fetchStub = sb.stub(webClient, "fetch");
		showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves(undefined);
		openInBrowser = sb.stub(envUtils, "openInBrowser").resolves(true);
		setCheckForSdkUpdates = sb.stub(config, "setCheckForSdkUpdates").resolves();
		sb.stub(config, "checkForSdkUpdates").get(() => true);
	});

	function createWorkspaceContext({
		dartVersion = "3.0.0",
		dartSdkIsFromFlutter = false,
		disableSdkUpdateChecks = false,
	}: {
		dartVersion?: string;
		dartSdkIsFromFlutter?: boolean;
		disableSdkUpdateChecks?: boolean;
	} = {}): WorkspaceContext {
		return new WorkspaceContext(
			{
				dart: "/sdks/dart",
				dartSdkIsFromFlutter,
				dartVersion,
				isPreReleaseSdk: false,
			},
			{
				disableSdkUpdateChecks,
			},
			false,
			false,
			true,
			false,
			undefined,
			undefined,
		);
	}

	describe("getLatestSdkVersion", () => {
		it("fetches and parses the latest version from JSON", async () => {
			fetchStub.withArgs("https://storage.googleapis.com/dart-archive/channels/stable/release/latest/VERSION")
				.resolves(JSON.stringify({ version: "3.5.0" }));

			const version = await getLatestSdkVersion(webClient);
			assert.equal(version, "3.5.0");
		});

		it("throws a descriptive error when JSON cannot be parsed", async () => {
			fetchStub.resolves("not-json");

			await assert.rejects(
				() => getLatestSdkVersion(webClient),
				/Failed to parse latest Dart SDK Version from JSON: not-json/,
			);
		});
	});

	describe("checkForStandardDartSdkUpdates", () => {
		it("does nothing when checkForSdkUpdates config is false", async () => {
			sb.stub(config, "checkForSdkUpdates").get(() => false);
			await checkForStandardDartSdkUpdates(logger, createWorkspaceContext(), webClient);
			assert.equal(fetchStub.called, false);
		});

		it("does nothing when workspaceContext disables SDK update checks", async () => {
			await checkForStandardDartSdkUpdates(logger, createWorkspaceContext({ disableSdkUpdateChecks: true }), webClient);
			assert.equal(fetchStub.called, false);
		});

		it("does nothing when Dart SDK is from Flutter", async () => {
			await checkForStandardDartSdkUpdates(logger, createWorkspaceContext({ dartSdkIsFromFlutter: true }), webClient);
			assert.equal(fetchStub.called, false);
		});

		it("does not prompt when current SDK is up to date", async () => {
			fetchStub.resolves(JSON.stringify({ version: "3.0.0" }));
			await checkForStandardDartSdkUpdates(logger, createWorkspaceContext({ dartVersion: "3.0.0" }), webClient);
			assert.equal(showWarningMessage.called, false);
		});

		it("prompts when a newer SDK version is available and opens downloads on action", async () => {
			fetchStub.resolves(JSON.stringify({ version: "3.5.0" }));
			showWarningMessage.resolves("Go to Dart Downloads");

			await checkForStandardDartSdkUpdates(logger, createWorkspaceContext({ dartVersion: "3.0.0" }), webClient);

			assert.equal(showWarningMessage.calledOnce, true);
			assert.ok((showWarningMessage.firstCall.args[0] as string).includes("Version 3.5.0 of the Dart SDK is available (you have 3.0.0)."));
			assert.equal(openInBrowser.calledOnceWithExactly(DART_DOWNLOAD_URL), true);
		});

		it("disables update checks when Disable Update Checks is clicked", async () => {
			fetchStub.resolves(JSON.stringify({ version: "3.5.0" }));
			showWarningMessage.resolves("Disable Update Checks");

			await checkForStandardDartSdkUpdates(logger, createWorkspaceContext({ dartVersion: "3.0.0" }), webClient);

			assert.equal(setCheckForSdkUpdates.calledOnceWithExactly(false), true);
		});

		it("logs errors when fetching fails", async () => {
			const error = new Error("Network failure");
			fetchStub.rejects(error);

			await checkForStandardDartSdkUpdates(logger, createWorkspaceContext(), webClient);

			assert.equal(logger.error.calledOnceWithExactly(error), true);
		});
	});

	describe("WebClient", () => {
		let server: http.Server | undefined;

		afterEach(() => {
			server?.close();
			server = undefined;
		});

		it("handles chunked responses, redirects, and error responses cleanly", async () => {
			const client = new WebClient("1.0.0");
			server = http.createServer((req, res) => {
				if (req.url === "/version") {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.write('{"ver');
					res.end('sion": "3.6.0"}');
				} else if (req.url === "/redirect") {
					const port = (server!.address() as { port: number }).port;
					res.writeHead(302, { Location: `http://127.0.0.1:${port}/version` });
					res.end("redirecting");
				} else {
					res.writeHead(500, "Server Error");
					res.end("error body");
				}
			});
			await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
			const port = (server.address() as { port: number }).port;

			const redirectedBody = await client.fetch(`http://127.0.0.1:${port}/redirect`);
			assert.equal(JSON.parse(redirectedBody).version, "3.6.0");

			await assert.rejects(
				() => client.fetch(`http://127.0.0.1:${port}/error`),
				(err: { message?: string }) => !!err?.message?.includes("Bad status code for /error: 500"),
			);
		});

		it("rejects on connection errors", async () => {
			const client = new WebClient("1.0.0");
			await assert.rejects(() => client.fetch("http://127.0.0.1:1/unreachable"));
		});
	});
});
