import { ExtensionContext, Uri } from "vscode";
import { DartWorkspaceContext } from "../interfaces";

export class Context {
	private constructor(public readonly context: ExtensionContext, public readonly workspaceContext: DartWorkspaceContext) {
	}

	// Helper we can manually call in the constructor when testing.
	public async clear(): Promise<void> {
		for (const clearableKey of this.context.globalState.keys())
			await this.context.globalState.update(clearableKey, undefined);
		for (const clearableKey of this.context.workspaceState.keys())
			await this.context.workspaceState.update(clearableKey, undefined);
	}

	public static for(context: ExtensionContext, workspaceContext: DartWorkspaceContext): Context {
		return new Context(context, workspaceContext);
	}

	get extensionStorageUri(): Uri {
		return this.context.globalStorageUri;
	}

	get devToolsNotificationLastShown(): number | undefined { return this.context.globalState.get("devToolsNotificationLastShown") as number; }
	set devToolsNotificationLastShown(value: number | undefined) { void this.context.globalState.update("devToolsNotificationLastShown", value); }
	get devToolsNotificationDoNotShow(): boolean | undefined { return !!this.context.globalState.get("devToolsNotificationDoNotShowAgain"); }
	set devToolsNotificationDoNotShow(value: boolean | undefined) { void this.context.globalState.update("devToolsNotificationDoNotShowAgain", value); }
	get breakpointInNonDebuggableFileDoNotShowAgain(): boolean | undefined { return !!this.context.globalState.get("breakpointInNonDebuggableFileDoNotShowAgain"); }
	set breakpointInNonDebuggableFileDoNotShowAgain(value: boolean | undefined) { void this.context.globalState.update("breakpointInNonDebuggableFileDoNotShowAgain", value); }
	public getFlutterSurveyNotificationLastShown(id: string): number | undefined { return this.context.globalState.get(`flutterSurvey${id}NotificationLastShown`) as number; }
	public setFlutterSurveyNotificationLastShown(id: string, value: number | undefined) { void this.context.globalState.update(`flutterSurvey${id}NotificationLastShown`, value); }
	public getFlutterSurveyNotificationDoNotShow(id: string): boolean | undefined { return !!this.context.globalState.get(`flutterSurvey${id}NotificationDoNotShowAgain`); }
	public setFlutterSurveyNotificationDoNotShow(id: string, value: boolean | undefined) { void this.context.globalState.update(`flutterSurvey${id}NotificationDoNotShowAgain`, value); }
	public getSdkDeprecationNoticeDoNotShow(dartSdkVersion: string): boolean | undefined { return !!this.context.globalState.get(`dartSdk${dartSdkVersion}DeprecationNotificationDoNotShowAgain`); }
	public setSdkDeprecationNoticeDoNotShow(dartSdkVersion: string, value: boolean | undefined) { void this.context.globalState.update(`dartSdk${dartSdkVersion}DeprecationNotificationDoNotShowAgain`, value); }
	get hasWarnedAboutFormatterSyntaxLimitation(): boolean { return !!this.context.globalState.get("hasWarnedAboutFormatterSyntaxLimitation"); }
	set hasWarnedAboutFormatterSyntaxLimitation(value: boolean) { void this.context.globalState.update("hasWarnedAboutFormatterSyntaxLimitation", value); }
	get hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation(): boolean { return !!this.context.globalState.get("hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation"); }
	set hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation(value: boolean) { void this.context.globalState.update("hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation", value); }
	get hasNotifiedAboutProfileModeDefaultConfiguration(): boolean { return !!this.context.globalState.get("hasNotifiedAboutProfileModeDefaultConfiguration"); }
	set hasNotifiedAboutProfileModeDefaultConfiguration(value: boolean) { void this.context.globalState.update("hasNotifiedAboutProfileModeDefaultConfiguration", value); }
	get lastSeenVersion(): string | undefined { return this.context.globalState.get("lastSeenVersion"); }
	set lastSeenVersion(value: string | undefined) { void this.context.globalState.update("lastSeenVersion", value); }
	get lastUsedNewProjectPath(): string | undefined { return this.context.globalState.get("lastUsedNewProjectPath"); }
	set lastUsedNewProjectPath(value: string | undefined) { void this.context.globalState.update("lastUsedNewProjectPath", value); }

	public getPackageLastCheckedForUpdates(packageID: string): number | undefined { return this.context.globalState.get(`packageLastCheckedForUpdates:${packageID}`) as number; }
	public setPackageLastCheckedForUpdates(packageID: string, value: number | undefined) { void this.context.globalState.update(`packageLastCheckedForUpdates:${packageID}`, value); }

	public getIgnoredExtensionRecommendationIdentifiers(): string[] { return this.context.globalState.get(`ignoredExtensionRecommendations`) ?? []; }
	public ignoreExtensionRecommendation(extension: string) { void this.context.globalState.update(`ignoredExtensionRecommendations`, [...this.getIgnoredExtensionRecommendationIdentifiers(), extension]); }

	public update(key: string, value: any): any {
		return this.context.globalState.update(key, value);
	}
	public get(key: string): any {
		return this.context.globalState.get(key);
	}

	public asAbsolutePath(relativePath: string): string {
		return this.context.asAbsolutePath(relativePath);
	}

	// Workspace-specific.

	get workspaceLastFlutterDeviceId(): string | undefined { return this.context.workspaceState.get("workspaceLastFlutterDeviceId"); }
	set workspaceLastFlutterDeviceId(value: string | undefined) { void this.context.workspaceState.update("workspaceLastFlutterDeviceId", value); }
}
