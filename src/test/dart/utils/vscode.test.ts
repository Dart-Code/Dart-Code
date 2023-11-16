import { strict as assert } from "assert";
import * as vs from "vscode";
import { buildHostKind, envUtils } from "../../../shared/vscode/utils";
import { sb } from "../../helpers";

describe("buildHostKind", () => {
	function verify(appName: string | undefined, appHost: string | undefined, remoteName: string | undefined, expected: string | undefined) {
		assert.equal(buildHostKind({ appName, appHost, remoteName }), expected);
	}

	it("builds the correct standard Desktop string", () => {
		verify("Visual Studio Code", "desktop", undefined, undefined);
		verify("Visual Studio Code", "desktop", "", undefined);
		verify("Visual Studio Code", "", "", undefined);
	});

	it("handles misreported 'desktop' cloud IDEs", () => {
		verify("Theia", "desktop", "", "web");
		verify("Cloud Shell", "desktop", "", "web");
		verify("IDX", "desktop", "a", "web-a");
	});

	it("converts host remoteNames to top level domains", () => {
		verify("Foo", "web", "cloudthing.dev", "web-cloudthing.dev");
		verify("Foo", "web", "myapp.cloudthing.dev", "web-cloudthing.dev");
		verify("Foo", "web", "myapp.me.cloudthing.dev", "web-cloudthing.dev");
	});

	it("removes port numbers", () => {
		verify("Foo", "web", "cloudthing.dev:1234", "web-cloudthing.dev");
		verify("Foo", "server", "distro-143.192:8080", "server-distro");
	});

	it("handles only appName", () => {
		verify("appName", "", "", undefined);
		verify("appName", undefined, undefined, undefined);
	});

	it("handles only appHost", () => {
		verify("", "appHost", "", "appHost");
		verify(undefined, "appHost", undefined, "appHost");
	});

	it("handles only remoteName", () => {
		verify("", "", "remoteName", "remoteName");
		verify(undefined, undefined, "remoteName", "remoteName");
	});
});

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

			// Nested URIs are also messed up on the querystring (which will be used when
			// DevTools moves to proper URLs).
			const encodedWsUri = encodeURIComponent("ws://localhost:1234/ABC=/ws");
			await testMap(
				`http://localhost:1234/ABCDE=/devtools/?uri=${encodedWsUri}&theme=$dark[0]`,
				`http://localhost:1234/ABCDE=/devtools/?uri=${encodedWsUri}&theme=$dark[0]`,
			);
		});
	});

	describe("when asExternalUri forces https", () => {
		beforeEach(() => {
			sb.stub(vs.env, "asExternalUri").callsFake((uri: vs.Uri) => uri.with({
				authority: uri.authority.replace("localhost", "localhostmapped").replace(":", ":8"),
				scheme: "https",
			}));
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
				if (!uri.authority.includes(":"))
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
	const mappedUri = await envUtils.exposeUrl(url);
	assert.equal(mappedUri, expected);
}
