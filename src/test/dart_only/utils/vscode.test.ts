import * as assert from "assert";
import * as vs from "vscode";
import { envUtils } from "../../../shared/vscode/utils";
import { sb } from "../../helpers";

describe("exposeUrl", () => {
	describe("when asExternalUri is a no-op", () => {
		it("returns same URLs for all protocols/ports", async () => {
			await testMap("http://localhost/test", "http://localhost/test");
			await testMap("http://localhost:80/test", "http://localhost/test");
			await testMap("http://localhost:123/test", "http://localhost:123/test");
			await testMap("https://localhost/test", "https://localhost/test");
			await testMap("https://localhost:443/test", "https://localhost/test");
			await testMap("https://localhost:123/test", "https://localhost:123/test");
			await testMap("ws://localhost/test", "ws://localhost/test");
			await testMap("ws://localhost:80/test", "ws://localhost/test");
			await testMap("ws://localhost:123/test", "ws://localhost:123/test");
			await testMap("wss://localhost/test", "wss://localhost/test");
			await testMap("wss://localhost:443/test", "wss://localhost/test");
			await testMap("wss://localhost:123/test", "wss://localhost:123/test");
		});

		it("works around VS Code's incorrectly encoded URIs", async () => {
			// VS Code URIs mess up $ and [ so they're fixed up by us.
			await testMap("http://localhost/$test", "http://localhost/$test");
			await testMap("http://[::1]/test", "http://[::1]/test");
		});
	});

	describe("when asExternalUri forces https", () => {
		beforeEach(() => {
			sb.stub(vs.env, "asExternalUri").callsFake((uri: vs.Uri) => {
				return uri.with({
					authority: uri.authority.replace("localhost", "localhostmapped").replace(":", ":8"),
					scheme: "https",
				});
			});
		});
		it("returns correct secure protocols for all URLs", async () => {
			await testMap("http://localhost/test", "https://localhostmapped:880/test");
			await testMap("http://localhost:123/test", "https://localhostmapped:8123/test");
			await testMap("https://localhost/test", "https://localhostmapped:8443/test");
			await testMap("https://localhost:123/test", "https://localhostmapped:8123/test");
			await testMap("ws://localhost/test", "wss://localhostmapped:880/test");
			await testMap("ws://localhost:123/test", "wss://localhostmapped:8123/test");
			await testMap("wss://localhost/test", "wss://localhostmapped:8443/test");
			await testMap("wss://localhost:123/test", "wss://localhostmapped:8123/test");
		});
	});

	describe("when asExternalUri fails to map portless URLs", () => {
		beforeEach(() => {
			sb.stub(vs.env, "asExternalUri").callsFake((uri: vs.Uri) => {
				// VS Code doesn't map URIs if there isn't an explicit port
				// so reproduce that here to ensure we account for it.
				if (uri.authority.indexOf(":") === -1)
					return uri;

				return uri.with({
					authority: uri.authority.replace("localhost", "localhostmapped").replace(":", ":8"),
					scheme: "https",
				});
			});
		});
		it("URLs are still exposed correctly", async () => {
			await testMap("http://localhost/test", "https://localhostmapped:880/test");
			await testMap("https://localhost/test", "https://localhostmapped:8443/test");
			await testMap("ws://localhost/test", "wss://localhostmapped:880/test");
			await testMap("wss://localhost/test", "wss://localhostmapped:8443/test");
			await testMap("http://localhost:123/test", "https://localhostmapped:8123/test");
			await testMap("https://localhost:123/test", "https://localhostmapped:8123/test");
			await testMap("ws://localhost:123/test", "wss://localhostmapped:8123/test");
			await testMap("wss://localhost:123/test", "wss://localhostmapped:8123/test");
		});
	});
});

async function testMap(url: string, expected: string): Promise<void> {
	const mappedUri = await envUtils.exposeUrl(vs.Uri.parse(url));
	assert.equal(mappedUri, expected);
}
