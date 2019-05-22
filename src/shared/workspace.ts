import { ExtensionContext } from "vscode";
import { Sdks } from "../extension/utils";

export class WorkspaceContext {
	// TODO: Move things from Sdks to this class that aren't related to the SDKs.
	constructor(
		public readonly sdks: Sdks,
		public readonly hasAnyFlutterMobileProjects: boolean,
		public readonly hasAnyFlutterWebProjects: boolean,
		public readonly hasAnyStandardDartProjects: boolean,
		public readonly hasProjectsInFuchsiaTree: boolean,
	) { }

	get hasOnlyDartProjects() { return !this.hasAnyFlutterProjects && !this.hasProjectsInFuchsiaTree; }
	get hasAnyFlutterProjects() { return this.hasAnyFlutterMobileProjects || this.hasAnyFlutterWebProjects; }
	get shouldLoadFlutterExtension() { return this.hasAnyFlutterProjects; }

	/// Used only for display (for ex stats), not behaviour.
	get workspaceTypeDescription(): string {
		const types: string[] = [];
		// Don't re-order these, else stats won't easily combine as we could have
		// Dart, Flutter and also Flutter, Dart.
		if (this.hasAnyStandardDartProjects)
			types.push("Dart");
		if (this.hasAnyFlutterMobileProjects)
			types.push("Flutter");
		if (this.hasAnyFlutterWebProjects)
			types.push("Flutter Web");
		if (this.hasProjectsInFuchsiaTree)
			types.push("Fuchsia");
		if (types.length === 0)
			types.push("Unknown");

		return types.join(", ");
	}

	// TODO: Since this class is passed around, we may need to make it update itself
	// (eg. if the last Flutter project is removed from the multi-root workspace)?
}

export class Context {
	private context: ExtensionContext;

	private constructor(context: ExtensionContext) {
		this.context = context;
	}

	public static for(context: ExtensionContext): Context {
		return new Context(context);
	}

	get devToolsNotificationsShown(): number | undefined { return (this.context.globalState.get("devToolsNotificationsShown") as number) || 0; }
	set devToolsNotificationsShown(value: number | undefined) { this.context.globalState.update("devToolsNotificationsShown", value); }
	get devToolsNotificationLastShown(): number | undefined { return this.context.globalState.get("devToolsNotificationLastShown") as number; }
	set devToolsNotificationLastShown(value: number | undefined) { this.context.globalState.update("devToolsNotificationLastShown", value); }
	get devToolsNotificationDoNotShow(): boolean | undefined { return !!this.context.globalState.get("devToolsNotificationDoNotShowAgain"); }
	set devToolsNotificationDoNotShow(value: boolean | undefined) { this.context.globalState.update("devToolsNotificationDoNotShowAgain", value); }
	get flutterSurvey2019Q2NotificationLastShown(): number | undefined { return this.context.globalState.get("flutterSurvey2019Q2NotificationLastShown") as number; }
	set flutterSurvey2019Q2NotificationLastShown(value: number | undefined) { this.context.globalState.update("flutterSurvey2019Q2NotificationLastShown", value); }
	get flutterSurvey2019Q2NotificationDoNotShow(): boolean | undefined { return !!this.context.globalState.get("flutterSurvey2019Q2NotificationDoNotShowAgain"); }
	set flutterSurvey2019Q2NotificationDoNotShow(value: boolean | undefined) { this.context.globalState.update("flutterSurvey2019Q2NotificationDoNotShowAgain", value); }
	get hasWarnedAboutFormatterSyntaxLimitation(): boolean { return !!this.context.globalState.get("hasWarnedAboutFormatterSyntaxLimitation"); }
	set hasWarnedAboutFormatterSyntaxLimitation(value: boolean) { this.context.globalState.update("hasWarnedAboutFormatterSyntaxLimitation", value); }
	get lastSeenVersion(): string | undefined { return this.context.globalState.get("lastSeenVersion"); }
	set lastSeenVersion(value: string | undefined) { this.context.globalState.update("lastSeenVersion", value); }

	public getPackageLastCheckedForUpdates(packageID: string): number | undefined { return this.context.globalState.get(`packageLastCheckedForUpdates:${packageID}`) as number; }
	public setPackageLastCheckedForUpdates(packageID: string, value: number | undefined) { this.context.globalState.update(`packageLastCheckedForUpdates:${packageID}`, value); }

	public update(key: string, value: any): any {
		return this.context.globalState.update(key, value);
	}
	public get(key: string): any {
		return this.context.globalState.get(key);
	}

	get subscriptions(): Array<{ dispose(): any }> { return this.context.subscriptions; }
}
