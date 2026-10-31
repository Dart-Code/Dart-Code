import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { nullLogger } from "../../../shared/logging";
import { fsPath, isWithinPathOrEqual } from "../../../shared/utils/fs";
import { buildHostKind, envUtils, isInHiddenFolder, isInsideFolderNamed } from "../../../shared/vscode/utils";
import { fixPath, sb } from "../../helpers";

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

	it("removes unknown server-distro hostnames", () => {
		verify("Foo", "server-distro", "my-ide.foo", "server-distro");
		verify("Foo", "server-distro-my-ide.foo", "bar", "server-distro");
		verify("Foo", "server-distro-my-ide.foo", "", "server-distro");
		verify("Foo", "server-distro-my-ide.foo", undefined, "server-distro");
		verify("Foo", "server-distro-my-ide.foo", "my-ide.foo", "server-distro");
	});

	it("retains known server-distro hostnames", () => {
		verify("Foo", "server-distro", "my-flutter-app.cluster-12345.cloudworkstations.dev", "cloudworkstations.dev");
		verify("Foo", "server-distro-my-ide.foo", "my-flutter-app.cluster-12345.cloudworkstations.dev", "cloudworkstations.dev");
	});

	it("removes local hosts", () => {
		verify("Foo", "my-cloud-ide", "danny.local", "my-cloud-ide");
		verify("Foo", "my-cloud-ide", "localhost", "my-cloud-ide");
		verify("Foo", "my-cloud-ide", "foo-danny.local", "my-cloud-ide");
	});

	it("removes port and version numbers", () => {
		verify("Foo", "web", "cloudthing.dev:1234", "web-cloudthing.dev");
		verify("Foo", "my-cloud-ide", "143.192:8080", "my-cloud-ide");
		verify("Foo", "my-cloud-ide", "foo-143.192:8080", "my-cloud-ide-foo");
		verify("Foo", "my-cloud-ide-1.2", "foo-143.192:8080", "my-cloud-ide-foo");
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
	const mappedUri = await envUtils.exposeUrl(url, nullLogger);
	assert.equal(mappedUri, expected);
}

describe("isInHiddenFolder", () => {
	// A workspace folder below a hidden ancestor directory, like a worktree
	// checked out below ".gemini" (https://github.com/Dart-Code/Dart-Code/issues/6299).
	const workspaceFolder = fixPath("/projects/.hidden/workspace");

	function stubWorkspaceFolders(folders: string[]) {
		sb.stub(vs.workspace, "getWorkspaceFolder").callsFake((uri: vs.Uri) => {
			const folder = folders.find((f) => isWithinPathOrEqual(fsPath(uri), f));
			return folder ? { index: 0, name: path.basename(folder), uri: vs.Uri.file(folder) } : undefined;
		});
	}

	it("returns false for undefined", () => {
		assert.equal(isInHiddenFolder(undefined), false);
	});

	it("does not treat hidden ancestors of the workspace folder as hidden", () => {
		stubWorkspaceFolders([workspaceFolder]);

		assert.equal(isInHiddenFolder(path.join(workspaceFolder, "pubspec.yaml")), false);
		assert.equal(isInHiddenFolder(vs.Uri.file(path.join(workspaceFolder, "pubspec.yaml"))), false);
	});

	it("ignores files inside hidden folders in the workspace", () => {
		stubWorkspaceFolders([workspaceFolder]);

		assert.equal(isInHiddenFolder(path.join(workspaceFolder, ".dart_tool", "pubspec.yaml")), true);
		assert.equal(isInHiddenFolder(vs.Uri.file(path.join(workspaceFolder, ".dart_tool", "pubspec.yaml"))), true);
		assert.equal(isInHiddenFolder(path.join(workspaceFolder, "nested", ".config", "pubspec.yaml")), true);
	});

	it("ignores files whose own names start with a dot", () => {
		stubWorkspaceFolders([workspaceFolder]);

		assert.equal(isInHiddenFolder(path.join(workspaceFolder, ".pubspec.yaml")), true);
	});

	it("does not treat .. segments as hidden folders", () => {
		// Simulate getWorkspaceFolder returning a folder the file is not actually
		// inside (eg. due to casing differences), producing `..` segments.
		sb.stub(vs.workspace, "getWorkspaceFolder").returns({ index: 0, name: "workspace", uri: vs.Uri.file(workspaceFolder) });

		assert.equal(isInHiddenFolder(path.join(fixPath("/projects/.hidden/other"), "sub", "pubspec.yaml")), false);
	});

	it("still finds hidden folders below .. segments", () => {
		sb.stub(vs.workspace, "getWorkspaceFolder").returns({ index: 0, name: "workspace", uri: vs.Uri.file(workspaceFolder) });

		assert.equal(isInHiddenFolder(path.join(fixPath("/projects/.hidden/other"), ".config", "pubspec.yaml")), true);
	});

	it("handles multiple workspace folders", () => {
		const otherWorkspaceFolder = fixPath("/projects/other_workspace");
		stubWorkspaceFolders([workspaceFolder, otherWorkspaceFolder]);

		assert.equal(isInHiddenFolder(path.join(otherWorkspaceFolder, "pubspec.yaml")), false);
		assert.equal(isInHiddenFolder(path.join(otherWorkspaceFolder, ".dart_tool", "pubspec.yaml")), true);
	});

	it("is not confused by path case differences", () => {
		stubWorkspaceFolders([workspaceFolder]);

		// Without case normalization, path.relative() can produce `..` segments
		// for what is actually the same folder.
		assert.equal(isInHiddenFolder(path.join(workspaceFolder.replace("projects", "PROJECTS").replace("hidden", "HIDDEN"), "pubspec.yaml")), false);
	});

	it("checks only the basename when there is no workspace folder", () => {
		stubWorkspaceFolders([]);

		assert.equal(isInHiddenFolder(path.join(fixPath("/anything"), ".hidden", "pubspec.yaml")), false);
		assert.equal(isInHiddenFolder(path.join(fixPath("/anything"), ".pubspec.yaml")), true);
	});
});

describe("isInsideFolderNamed", () => {
	const workspaceFolder = fixPath("/projects/.hidden/workspace");

	beforeEach(() => {
		sb.stub(vs.workspace, "getWorkspaceFolder").callsFake((uri: vs.Uri) => {
			const folderPath = fsPath(uri);
			return isWithinPathOrEqual(folderPath, workspaceFolder)
				? { index: 0, name: path.basename(workspaceFolder), uri: vs.Uri.file(workspaceFolder) }
				: undefined;
		});
	});

	it("returns false for undefined", () => {
		assert.equal(isInsideFolderNamed(undefined, "build"), false);
	});

	it("matches a build folder inside the workspace", () => {
		assert.equal(isInsideFolderNamed(path.join(workspaceFolder, "build", "pubspec.yaml"), "build"), true);
		assert.equal(isInsideFolderNamed(vs.Uri.file(path.join(workspaceFolder, "build", "pubspec.yaml")), "build"), true);
	});

	it("does not match folders whose names merely contain the name", () => {
		assert.equal(isInsideFolderNamed(path.join(workspaceFolder, "build_tools", "pubspec.yaml"), "build"), false);
	});

	it("does not match folders outside the workspace folder", () => {
		assert.equal(isInsideFolderNamed(path.join(fixPath("/projects/other"), "build", "pubspec.yaml"), "build"), false);
	});
});
