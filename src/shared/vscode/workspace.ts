import * as fs from "fs";
import * as path from "path";
import { Disposable, ExtensionContext, Memento, Uri } from "vscode";
import { cursorInstallMcpServer, installFlutterExtensionPromptKey, isDartCodeTestRun, onlyAnalyzeProjectsWithOpenFilesPromptKey, useRecommendedSettingsPromptKey, userPromptContextPrefix } from "../constants";
import { DartWorkspaceContext } from "../interfaces";
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

	private constructor(private readonly context: ExtensionContext, public readonly workspaceContext: DartWorkspaceContext) {
		/* eslint-disable dart-code/no-extension-context-state */
		const dartToolDir = !isDartCodeTestRun ? getDartToolDir() : undefined;
		const globalStoragePath = dartToolDir
			? path.join(dartToolDir, "dart-code")
			: fsPath(context.globalStorageUri);
		this.globalState = new GlobalState(context.globalState, globalStoragePath);
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

	public static for(context: ExtensionContext, workspaceContext: DartWorkspaceContext): Context {
		return new Context(context, workspaceContext);
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

	constructor(
		private readonly fallbackState: Memento,
		public readonly storagePath: string,
	) {
		this.stateFilePath = path.join(this.storagePath, "state.json");
	}

	/**
	 * Reads the current state directly from disk. Returns an empty object if the
	 * file does not exist or cannot be parsed.
	 */
	private readStateFromDisk(): Record<string, unknown> {
		try {
			if (!fs.existsSync(this.stateFilePath))
				return {};
			const content = fs.readFileSync(this.stateFilePath, "utf8");
			const parsed = JSON.parse(content) as unknown;
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? parsed as Record<string, unknown>
				: {};
		} catch {
			return {};
		}
	}

	private get<T>(key: string): T | undefined {
		// Cache in memory for reads so we don't hit the disk on every property access.
		this.state ??= this.readStateFromDisk();
		if (Object.prototype.hasOwnProperty.call(this.state, key)) {
			const val = this.state[key];
			return val === null ? undefined : val as T;
		}

		// Fall back to VS Code's per-profile globalState for values set prior to
		// moving to the cross-profile store, and migrate them to the new store.
		const fallbackValue = this.fallbackState.get<T>(key);
		if (fallbackValue !== undefined)
			this.set(key, fallbackValue);
		return fallbackValue;
	}

	private set(key: string, value: unknown): void {
		try {
			fs.mkdirSync(this.storagePath, { recursive: true });
			// Always re-read from disk right before writing so we don't overwrite
			// changes made concurrently by other VS Code windows or profiles.
			const data = this.readStateFromDisk();
			// Store null when resetting to undefined so we know the key was explicitly
			// cleared in the global store and should not fall back to ExtensionContext.globalState.
			data[key] = value === undefined ? null : value;
			this.state = data;
			fs.writeFileSync(this.stateFilePath, JSON.stringify(data, undefined, "\t"));
		} catch {
			// Still update in-memory state if disk write fails so the current session behaves consistently.
			this.state ??= {};
			this.state[key] = value === undefined ? null : value;
		}
	}

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

	public async clear(): Promise<void> {
		for (const clearableKey of this.state.keys())
			await this.state.update(clearableKey, undefined);
	}

	public get lastFlutterDeviceId(): string | undefined { return this.state.get("workspaceLastFlutterDeviceId"); }
	public set lastFlutterDeviceId(value: string | undefined) { void this.state.update("workspaceLastFlutterDeviceId", value); }
}
