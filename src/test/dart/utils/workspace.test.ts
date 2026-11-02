import { strict as assert } from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { cursorInstallMcpServer, installFlutterExtensionPromptKey } from "../../../shared/constants";
import { nullLogger } from "../../../shared/logging";
import { simplifyVersion } from "../../../shared/utils/workspace";
import { GlobalState, ProfileState, WorkspaceState } from "../../../shared/vscode/workspace";
import { defer, tryDelete } from "../../helpers";

describe("simplifyVersion", () => {
	it("handles simple x.y.z versions", () => {
		assert.equal(simplifyVersion("1.2.3"), "1.2.x");
		assert.equal(simplifyVersion("0.0.3"), "0.0.x");
		assert.equal(simplifyVersion("999.998.997"), "999.998.x");
	});

	it("handles simple x.y versions", () => {
		assert.equal(simplifyVersion("1.2"), "1.2.x");
		assert.equal(simplifyVersion("0.0"), "0.0.x");
		assert.equal(simplifyVersion("999.998"), "999.998.x");
	});

	it("handles simple x.y.z with known pre-release kinds", () => {
		for (const knownName of ["beta", "alpha", "dev", "edge"]) {
			assert.equal(simplifyVersion(`3.1.0-63.1.${knownName}`), `3.1.x-${knownName}`);
			assert.equal(simplifyVersion(`3.1.0-${knownName}.1.2`), `3.1.x-${knownName}`);
			assert.equal(simplifyVersion(`3.1.0-1.${knownName}.2`), `3.1.x-${knownName}`);
		}
	});

	it("handles simple x.y with known pre-release kinds", () => {
		for (const knownName of ["beta", "alpha", "dev", "edge"]) {
			assert.equal(simplifyVersion(`3.0-63.1.${knownName}`), `3.0.x-${knownName}`);
			assert.equal(simplifyVersion(`3.0-${knownName}.1.2`), `3.0.x-${knownName}`);
			assert.equal(simplifyVersion(`3.0-1.${knownName}.2`), `3.0.x-${knownName}`);
		}
	});

	it("handles simple x.y.z with unknown pre-release kinds", () => {
		assert.equal(simplifyVersion("3.1.0-63.1.apple"), "3.1.x-pre");
		assert.equal(simplifyVersion("3.1.0-apple.pear.123"), "3.1.x-pre");
		assert.equal(simplifyVersion("3.1.0-123.apple.123"), "3.1.x-pre");
	});

	it("handles simple x.y with unknown pre-release kinds", () => {
		assert.equal(simplifyVersion("3.0-63.1.apple"), "3.0.x-pre");
		assert.equal(simplifyVersion("3.0-apple.pear.123"), "3.0.x-pre");
		assert.equal(simplifyVersion("3.0-123.apple.123"), "3.0.x-pre");
	});

	it("handles non-strings", () => {
		assert.equal(simplifyVersion(1), undefined);
		assert.equal(simplifyVersion(null), undefined);
		assert.equal(simplifyVersion(undefined), undefined);
		assert.equal(simplifyVersion(true), undefined);
		assert.equal(simplifyVersion({}), undefined);
	});

	it("handles other non-standard input", () => {
		assert.equal(simplifyVersion("1"), "1.x.x");
		assert.equal(simplifyVersion("1-foo"), "1.x.x-pre");
		assert.equal(simplifyVersion("TEST"), "TEST.x.x");
		assert.equal(simplifyVersion(""), "0.x.x");
	});
});

describe("State storage wrappers", () => {
	function createFakeMemento(initialValues: Record<string, unknown> = {}): vs.Memento {
		const store = new Map<string, unknown>(Object.entries(initialValues));
		return {
			get<T>(key: string, defaultValue?: T): T | undefined {
				return store.has(key) ? store.get(key) as T : defaultValue;
			},
			keys(): readonly string[] {
				return Array.from(store.keys());
			},
			async update(key: string, value: unknown): Promise<void> {
				if (value === undefined)
					store.delete(key);
				else
					store.set(key, value);
			},
		};
	}

	function createTempStorageDir(): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dart-code-state-test-"));
		defer("Delete temp state dir", () => tryDelete(dir));
		return dir;
	}

	it("shares GlobalState across multiple profiles, caches reads in memory, and preserves concurrent writes", () => {
		const storageDir = path.join(createTempStorageDir(), "nested", "dart-code");
		const profile1 = new GlobalState(nullLogger, createFakeMemento(), storageDir);
		const profile2 = new GlobalState(nullLogger, createFakeMemento(), storageDir);

		// Writing from profile 1 creates the directory/file and is visible when profile 2 reads it.
		profile1.setFlutterSurveyNotificationDoNotShow("2026Q1", true);
		assert.equal(profile2.getFlutterSurveyNotificationDoNotShow("2026Q1"), true);

		// Writing a different key from profile 2 re-reads from disk before writing,
		// so it does not clobber profile 1's key, and updates profile 2's cache.
		profile2.lastSeenVersion = "3.148.0";
		profile1.hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation = true;
		profile1.setHasPrompted(cursorInstallMcpServer, true);
		profile2.setExperimentRandomNumber("exp1", 42);
		profile2.setExperimentHasActivated("exp1", true);

		// A new instance reading from disk sees all updates from both profiles.
		const profile3 = new GlobalState(nullLogger, createFakeMemento(), storageDir);
		assert.equal(profile3.lastSeenVersion, "3.148.0");
		assert.equal(profile3.hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation, true);
		assert.equal(profile3.getFlutterSurveyNotificationDoNotShow("2026Q1"), true);
		assert.equal(profile3.getHasPrompted(cursorInstallMcpServer), true);
		assert.equal(profile3.getExperimentRandomNumber("exp1"), 42);
		assert.equal(profile3.getExperimentHasActivated("exp1"), true);

		// Profile 1 also saw profile 2's write when profile 1 re-read before its own write.
		assert.equal(profile1.lastSeenVersion, "3.148.0");

		// Subsequent reads use the in-memory cache without re-reading disk.
		fs.unlinkSync(path.join(storageDir, "state.json"));
		assert.equal(profile3.lastSeenVersion, "3.148.0");
	});

	it("falls back to ExtensionContext.globalState when key is not in GlobalState and migrates it", () => {
		const storageDir = createTempStorageDir();
		const profile1Memento = createFakeMemento({
			flutterSurvey2026Q1NotificationDoNotShowAgain: true,
			lastSeenVersion: "3.146.0",
		});
		const profile2Memento = createFakeMemento();

		const profile1 = new GlobalState(nullLogger, profile1Memento, storageDir);
		const profile2 = new GlobalState(nullLogger, profile2Memento, storageDir);

		// Profile 1 falls back to its Memento and migrates the value to state.json.
		assert.equal(profile1.getFlutterSurveyNotificationDoNotShow("2026Q1"), true);
		assert.equal(profile1.lastSeenVersion, "3.146.0");

		// Profile 2 now sees the migrated values too.
		assert.equal(profile2.getFlutterSurveyNotificationDoNotShow("2026Q1"), true);
		assert.equal(profile2.lastSeenVersion, "3.146.0");
	});

	it("does not fall back to ExtensionContext.globalState if a key was set in GlobalState and then reset", () => {
		const storageDir = createTempStorageDir();
		const profile1Memento = createFakeMemento({
			"lastSeenVersion": "3.146.0",
			"packageLastCheckedForUpdates:devtools": 12345,
		});

		const profile1 = new GlobalState(nullLogger, profile1Memento, storageDir);

		// First read migrates from Memento (or we set a new value in GlobalState).
		assert.equal(profile1.lastSeenVersion, "3.146.0");
		profile1.lastSeenVersion = "3.148.0";
		assert.equal(profile1.lastSeenVersion, "3.148.0");

		// Now reset lastSeenVersion to undefined in GlobalState.
		// Even though profile1Memento still has "3.146.0", GlobalState must NOT fall back to it.
		profile1.lastSeenVersion = undefined;
		assert.equal(profile1.lastSeenVersion, undefined);

		// Also test resetting a key directly without reading/migrating it first.
		profile1.setPackageLastCheckedForUpdates("devtools", undefined);
		assert.equal(profile1.getPackageLastCheckedForUpdates("devtools"), undefined);
	});

	it("does not overwrite newer shared values when migrating a legacy key after initial cache load", () => {
		const storageDir = createTempStorageDir();
		// Profile A has a legacy true value in its per-profile Memento.
		const profileAMemento = createFakeMemento({
			"hasPrompted.cursor_install_mcp_server": true,
			"lastSeenVersion": "3.144.0",
		});
		const profileA = new GlobalState(nullLogger, profileAMemento, storageDir);
		const profileB = new GlobalState(nullLogger, createFakeMemento(), storageDir);

		// Profile A performs an unrelated read, populating its in-memory cache (which does not have cursorInstallMcpServer yet).
		assert.equal(profileA.getFlutterSurveyNotificationDoNotShow("2026Q1"), false);

		// Profile B subsequently writes false for cursorInstallMcpServer and clears lastSeenVersion in the shared file.
		profileB.setHasPrompted(cursorInstallMcpServer, false);
		profileB.lastSeenVersion = undefined;

		// When Profile A reads those keys, it must re-read from disk before migrating its legacy Memento values,
		// returning Profile B's newer shared decisions rather than overwriting them with legacy values.
		assert.equal(profileA.getHasPrompted(cursorInstallMcpServer), false);
		assert.equal(profileA.lastSeenVersion, undefined);
		assert.equal(profileB.getHasPrompted(cursorInstallMcpServer), false);
	});

	it("re-reads from disk after the cache duration expires", () => {
		const storageDir = createTempStorageDir();
		// Use a 0ms cache duration so every read refreshes from disk.
		const profile1 = new GlobalState(nullLogger, createFakeMemento(), storageDir, 0);
		const profile2 = new GlobalState(nullLogger, createFakeMemento(), storageDir, 0);

		profile1.lastSeenVersion = "3.146.0";
		assert.equal(profile2.lastSeenVersion, "3.146.0");

		profile1.lastSeenVersion = "3.148.0";
		assert.equal(profile2.lastSeenVersion, "3.148.0");
	});

	it("retains pending updates across cache expiry and subsequent writes when a disk write fails", () => {
		const storageDir = createTempStorageDir();
		const stateFilePath = path.join(storageDir, "state.json");
		// Use a 0ms cache duration so every read re-reads from disk.
		const profile1 = new GlobalState(nullLogger, createFakeMemento(), storageDir, 0);
		profile1.lastSeenVersion = "3.146.0";

		// Replace state.json with a directory to force renameSync to fail on the next write,
		// then restore the original state.json content so disk still only has the initial state.
		const savedContent = fs.readFileSync(stateFilePath, "utf8");
		fs.unlinkSync(stateFilePath);
		fs.mkdirSync(stateFilePath);
		profile1.setFlutterSurveyNotificationDoNotShow("2026Q1", true);
		fs.rmdirSync(stateFilePath);
		fs.writeFileSync(stateFilePath, savedContent);

		// Even though the disk write failed and the cache expires (0ms) so it re-reads the old
		// state.json from disk, the pending update is merged and retained on read.
		assert.equal(profile1.getFlutterSurveyNotificationDoNotShow("2026Q1"), true);

		// A subsequent write merges the pending update with the disk state and persists both.
		profile1.setExperimentRandomNumber("exp1", 42);

		const profile2 = new GlobalState(nullLogger, createFakeMemento(), storageDir);
		assert.equal(profile2.lastSeenVersion, "3.146.0");
		assert.equal(profile2.getFlutterSurveyNotificationDoNotShow("2026Q1"), true);
		assert.equal(profile2.getExperimentRandomNumber("exp1"), 42);
	});

	it("handles corrupted state.json gracefully and clears state properly", async () => {
		const storageDir = createTempStorageDir();
		fs.writeFileSync(path.join(storageDir, "state.json"), "{ invalid json");

		const memento = createFakeMemento({ lastSeenVersion: "3.146.0" });
		const globalState = new GlobalState(nullLogger, memento, storageDir);

		// Does not throw and falls back cleanly.
		assert.equal(globalState.lastSeenVersion, "3.146.0");

		// Writing overwrites the invalid JSON with valid JSON.
		globalState.lastSeenVersion = "3.148.0";
		assert.equal(globalState.lastSeenVersion, "3.148.0");

		// Clearing wipes both state.json and Memento.
		await globalState.clear();
		assert.equal(globalState.lastSeenVersion, undefined);
	});

	it("keeps ProfileState isolated per profile and WorkspaceState isolated per workspace", () => {
		const profile1 = new ProfileState(createFakeMemento());
		const profile2 = new ProfileState(createFakeMemento());

		profile1.setHasPrompted(installFlutterExtensionPromptKey, true);
		profile1.ignoreExtensionRecommendation("some.extension");
		profile1.lastUsedNewProjectPath = "/path/one";

		assert.equal(profile1.getHasPrompted(installFlutterExtensionPromptKey), true);
		assert.equal(profile2.getHasPrompted(installFlutterExtensionPromptKey), false);
		assert.deepEqual(profile1.getIgnoredExtensionRecommendationIdentifiers(), ["some.extension"]);
		assert.deepEqual(profile2.getIgnoredExtensionRecommendationIdentifiers(), []);
		assert.equal(profile1.lastUsedNewProjectPath, "/path/one");
		assert.equal(profile2.lastUsedNewProjectPath, undefined);

		const ws1 = new WorkspaceState(createFakeMemento());
		const ws2 = new WorkspaceState(createFakeMemento());
		ws1.lastFlutterDeviceId = "macos";
		assert.equal(ws1.lastFlutterDeviceId, "macos");
		assert.equal(ws2.lastFlutterDeviceId, undefined);
	});
});
