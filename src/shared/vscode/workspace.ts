import * as fs from "fs";
import * as path from "path";
import { Disposable, ExtensionContext, Memento, Uri } from "vscode";
import { cursorInstallMcpServer, installFlutterExtensionPromptKey, isDartCodeTestRun, onlyAnalyzeProjectsWithOpenFilesPromptKey, tenMinutesInMs, useRecommendedSettingsPromptKey, userPromptContextPrefix } from "../constants";
import { DartWorkspaceContext, Logger } from "../interfaces";
import { fsPath, getDartToolDir } from "../utils/fs";

// Prompt keys for one-time user notifications that should apply across all VS Code profiles.
export type GlobalPromptKey = typeof onlyAnalyzeProjectsWithOpenFilesPromptKey | typeof cursorInstallMcpServer;

// Prompt keys for one-time notifications that inspect or mutate profile-scoped extensions or settings.
export type ProfilePromptKey = typeof installFlutterExtensionPromptKey | typeof useRecommendedSettingsPromptKey;

/**
 * Wraps `ExtensionContext` and `DartWorkspaceContext` to provide strongly-typed state storage
 * split into three scopes:
 *
 * - `globalState`: Shared across all VS Code profiles for the current OS user (stored in `~/.dart-tool/dart-code/state.json`).
 * - `profileState`: Scoped to the active VS Code profile (backed by `ExtensionContext.globalState`).
 * - `workspaceState`: Scoped to the active workspace (backed by `ExtensionContext.workspaceState`).
 */
export class Context {
	public readonly globalState: GlobalState;
	public readonly profileState: ProfileState;
	public readonly workspaceState: WorkspaceState;

	private constructor(private readonly context: ExtensionContext, logger: Logger, public readonly workspaceContext: DartWorkspaceContext) {
		/* eslint-disable dart-code/no-extension-context-state */
		const contextStoragePath = fsPath(context.globalStorageUri);
		const env = isDartCodeTestRun
			? { HOME: contextStoragePath, APPDATA: contextStoragePath }
			: process.env;
		const dartToolDir = getDartToolDir(env);
		const globalStoragePath = dartToolDir
			? path.join(dartToolDir, "dart-code")
			: contextStoragePath;
		this.globalState = new GlobalState(logger, context.globalState, globalStoragePath);
		this.profileState = new ProfileState(context.globalState);
		this.workspaceState = new WorkspaceState(context.workspaceState);
		/* eslint-enable dart-code/no-extension-context-state */
	}

	// Helper we can manually call in tests to reset all stored state.
	public async clear(): Promise<void> {
		await this.globalState.clear();
		await this.profileState.clear();
		await this.workspaceState.clear();
	}

	public static for(context: ExtensionContext, logger: Logger, workspaceContext: DartWorkspaceContext): Context {
		return new Context(context, logger, workspaceContext);
	}

	public get subscriptions(): Disposable[] {
		return this.context.subscriptions;
	}

	public get extensionStorageUri(): Uri {
		try {
			fs.mkdirSync(this.globalState.storagePath, { recursive: true });
		} catch {
			// Ignore errors creating directory.
		}
		return Uri.file(this.globalState.storagePath);
	}

	public asAbsolutePath(relativePath: string): string {
		return this.context.asAbsolutePath(relativePath);
	}
}

/**
 * State shared across all VS Code profiles for the current OS user, stored in
 * `~/.dart-tool/dart-code/state.json` (or `%APPDATA%\.dart-tool\dart-code\state.json` on Windows),
 * with read fallback to `ExtensionContext.globalState` for values stored prior to profile-splitting.
 */
export class GlobalState {
	private readonly stateFilePath: string;
	private state: Record<string, unknown> | undefined;
	private stateLoadedAt = 0;

	constructor(
		private readonly logger: Logger,
		private readonly fallbackState: Memento,
		public readonly storagePath: string,
		private readonly cacheDurationMs = tenMinutesInMs,
	) {
		this.stateFilePath = path.join(this.storagePath, "state.json");
	}

	/**
	 * Reads the current state directly from disk. Returns an empty object if the
	 * file does not exist, or falls back to any existing in-memory state if the file
	 * cannot be read or parsed (for example due to a transient file lock on Windows).
	 */
	private readStateFromDisk(): Record<string, unknown> {
		this.stateLoadedAt = Date.now();
		try {
			const content = fs.readFileSync(this.stateFilePath, "utf8");
			const parsed = JSON.parse(content) as unknown;
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? parsed as Record<string, unknown>
				: {};
		} catch (e) {
			if ((e as NodeJS.ErrnoException | undefined)?.code === "ENOENT")
				return {};
			this.logger.warn(`Failed to read global state from ${this.stateFilePath}: ${String(e)}`);
			return this.state ? { ...this.state } : {};
		}
	}

	/**
	 * Writes `this.state` to disk atomically via a temporary file and rename so
	 * concurrent readers never observe a truncated or partially-written file.
	 */
	private writeStateToDisk(): void {
		const tempFilePath = `${this.stateFilePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
		try {
			fs.mkdirSync(this.storagePath, { recursive: true });
			fs.writeFileSync(tempFilePath, JSON.stringify(this.state, undefined, "\t"));
			fs.renameSync(tempFilePath, this.stateFilePath);
		} catch (e) {
			this.logger.warn(`Failed to write global state to ${this.stateFilePath}: ${String(e)}`);
			// Ignore disk or locking errors (such as Windows file locks); in-memory state is already updated.
			try {
				if (fs.existsSync(tempFilePath))
					fs.unlinkSync(tempFilePath);
			} catch {
				// Ignore cleanup errors.
			}
		}
	}

	private get<T>(key: string): T | undefined {
		// Cache in memory for reads so we don't hit the disk on every property access,
		// but re-read periodically in case another window or profile updated the file.
		if (!this.state || Date.now() - this.stateLoadedAt >= this.cacheDurationMs)
			this.state = this.readStateFromDisk();

		if (Object.prototype.hasOwnProperty.call(this.state, key)) {
			const val = this.state[key];
			return val === null ? undefined : val as T;
		}

		// Fall back to VS Code's per-profile globalState for values set prior to
		// moving to the cross-profile store, and migrate them to the new store.
		//
		// Because `fallbackState` is scoped to the active VS Code profile:
		// - If a user has legacy values in Profile A, but first opens Profile B (which
		//   has no legacy values) and reads a key, `fallbackState.get(key)` in Profile B
		//   returns `undefined` and nothing is written to `state.json`.
		// - When the user later opens Profile A and reads that key, the key is still
		//   absent from `state.json`, so Profile A will read its legacy value from its
		//   own `fallbackState` and migrate it into `state.json` (making it visible to
		//   Profile B on subsequent reads).
		// - If Profile B explicitly writes a new value for the key before Profile A
		//   migrates it, `state.json` will contain Profile B's value, and Profile A's
		//   fresh disk check below will see the key is now present and use Profile B's
		//   newer shared value rather than overwriting it with Profile A's older value.
		const fallbackValue = this.fallbackState.get<T>(key);
		if (fallbackValue !== undefined) {
			// Re-read from disk before migrating in case another profile wrote or cleared
			// this key since our cache was populated. Only migrate if still absent on disk.
			const data = this.readStateFromDisk();
			if (Object.prototype.hasOwnProperty.call(data, key)) {
				this.state = data;
				const val = data[key];
				return val === null ? undefined : val as T;
			}
			data[key] = fallbackValue;
			this.state = data;
			this.writeStateToDisk();
		}
		return fallbackValue;
	}

	private set(key: string, value: unknown): void {
		// Always re-read from disk right before writing so we don't overwrite
		// changes made concurrently by other VS Code windows or profiles.
		const data = this.readStateFromDisk();
		// Store null when resetting to undefined so we know the key was explicitly
		// cleared in the global store and should not fall back to ExtensionContext.globalState.
		data[key] = value === undefined ? null : value;
		this.state = data;
		this.writeStateToDisk();
	}

	// Helper for tests to reset stored state between test runs.
	public async clear(): Promise<void> {
		this.state = {};
		try {
			if (fs.existsSync(this.stateFilePath))
				fs.unlinkSync(this.stateFilePath);
		} catch {
			// Ignore.
		}
		for (const clearableKey of this.fallbackState.keys())
			await this.fallbackState.update(clearableKey, undefined);
	}

	public get lastSeenVersion(): string | undefined { return this.get("lastSeenVersion"); }
	public set lastSeenVersion(value: string | undefined) { this.set("lastSeenVersion", value); }

	public get hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation(): boolean { return !!this.get("hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation"); }
	public set hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation(value: boolean | undefined) { this.set("hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation", value); }

	public get hasNotifiedAboutProfileModeDefaultConfiguration(): boolean { return !!this.get("hasNotifiedAboutProfileModeDefaultConfiguration"); }
	public set hasNotifiedAboutProfileModeDefaultConfiguration(value: boolean | undefined) { this.set("hasNotifiedAboutProfileModeDefaultConfiguration", value); }

	public getFlutterSurveyNotificationLastShown(id: string): number | undefined { return this.get<number>(`flutterSurvey${id}NotificationLastShown`); }
	public setFlutterSurveyNotificationLastShown(id: string, value: number | undefined): void { this.set(`flutterSurvey${id}NotificationLastShown`, value); }

	public getFlutterSurveyNotificationDoNotShow(id: string): boolean { return !!this.get(`flutterSurvey${id}NotificationDoNotShowAgain`); }
	public setFlutterSurveyNotificationDoNotShow(id: string, value: boolean | undefined): void { this.set(`flutterSurvey${id}NotificationDoNotShowAgain`, value); }

	public getSdkDeprecationNoticeDoNotShow(dartSdkVersion: string): boolean { return !!this.get(`dartSdk${dartSdkVersion}DeprecationNotificationDoNotShowAgain`); }
	public setSdkDeprecationNoticeDoNotShow(dartSdkVersion: string, value: boolean | undefined): void { this.set(`dartSdk${dartSdkVersion}DeprecationNotificationDoNotShowAgain`, value); }

	public getAppWarningDoNotShow(warningId: string): boolean { return !!this.get(`appWarning${warningId}DoNotShowAgain`); }
	public setAppWarningDoNotShow(warningId: string, value: boolean | undefined): void { this.set(`appWarning${warningId}DoNotShowAgain`, value); }

	public getPackageLastCheckedForUpdates(packageID: string): number | undefined { return this.get<number>(`packageLastCheckedForUpdates:${packageID}`); }
	public setPackageLastCheckedForUpdates(packageID: string, value: number | undefined): void { this.set(`packageLastCheckedForUpdates:${packageID}`, value); }

	public getHasPrompted(key: GlobalPromptKey): boolean { return this.get(`${userPromptContextPrefix}${key}`) === true; }
	public setHasPrompted(key: GlobalPromptKey, value: boolean | undefined): void { this.set(`${userPromptContextPrefix}${key}`, value); }

	public getExperimentRandomNumber(id: string): number | undefined { return this.get<number>(`experiment-${id}`); }
	public setExperimentRandomNumber(id: string, value: number | undefined): void { this.set(`experiment-${id}`, value); }

	public getExperimentHasActivated(id: string): boolean { return !!this.get(`experiment-${id}-hasActivated`); }
	public setExperimentHasActivated(id: string, value: boolean | undefined): void { this.set(`experiment-${id}-hasActivated`, value); }
}

/**
 * State scoped to the active VS Code profile, backed by `ExtensionContext.globalState`.
 */
export class ProfileState {
	constructor(private readonly state: Memento) { }

	// Helper for tests to reset stored state between test runs.
	public async clear(): Promise<void> {
		for (const clearableKey of this.state.keys())
			await this.state.update(clearableKey, undefined);
	}

	public get devToolsNotificationLastShown(): number | undefined { return this.state.get<number>("devToolsNotificationLastShown"); }
	public set devToolsNotificationLastShown(value: number | undefined) { void this.state.update("devToolsNotificationLastShown", value); }

	public get devToolsNotificationDoNotShow(): boolean { return !!this.state.get("devToolsNotificationDoNotShowAgain"); }
	public set devToolsNotificationDoNotShow(value: boolean | undefined) { void this.state.update("devToolsNotificationDoNotShowAgain", value); }

	public get breakpointInNonDebuggableFileDoNotShowAgain(): boolean | undefined { return !!this.state.get("breakpointInNonDebuggableFileDoNotShowAgain"); }
	public set breakpointInNonDebuggableFileDoNotShowAgain(value: boolean | undefined) { void this.state.update("breakpointInNonDebuggableFileDoNotShowAgain", value); }

	public get lastUsedNewProjectPath(): string | undefined { return this.state.get("lastUsedNewProjectPath"); }
	public set lastUsedNewProjectPath(value: string | undefined) { void this.state.update("lastUsedNewProjectPath", value); }

	public getIgnoredExtensionRecommendationIdentifiers(): string[] { return this.state.get("ignoredExtensionRecommendations") ?? []; }
	public ignoreExtensionRecommendation(extension: string): void { void this.state.update("ignoredExtensionRecommendations", [...this.getIgnoredExtensionRecommendationIdentifiers(), extension]); }

	public getHasPrompted(key: ProfilePromptKey): boolean { return this.state.get(`${userPromptContextPrefix}${key}`) === true; }
	public setHasPrompted(key: ProfilePromptKey, value: boolean | undefined): void { void this.state.update(`${userPromptContextPrefix}${key}`, value); }
}

/**
 * State scoped to the active VS Code workspace, backed by `ExtensionContext.workspaceState`.
 */
export class WorkspaceState {
	constructor(private readonly state: Memento) { }

	// Helper for tests to reset stored state between test runs.
	public async clear(): Promise<void> {
		for (const clearableKey of this.state.keys())
			await this.state.update(clearableKey, undefined);
	}

	public get lastFlutterDeviceId(): string | undefined { return this.state.get("workspaceLastFlutterDeviceId"); }
	public set lastFlutterDeviceId(value: string | undefined) { void this.state.update("workspaceLastFlutterDeviceId", value); }
}
