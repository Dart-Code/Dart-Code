import { ExtensionContext } from "vscode";

export class Context {
	private context: ExtensionContext;

	private constructor(context: ExtensionContext) {
		this.context = context;
	}

	public static for(context: ExtensionContext): Context {
		return new Context(context);
	}

	// get newFlutterProject() { return this.context.globalState.get("newFlutterProject") as string; }
	// set newFlutterProject(value: string) { this.context.globalState.update("newFlutterProject", value); }
	get devToolsNotificationsShown(): number { return (this.context.globalState.get("devToolsNotificationsShown") as number) || 0; }
	set devToolsNotificationsShown(value: number) { this.context.globalState.update("devToolsNotificationsShown", value); }
	get devToolsNotificationLastShown(): number | undefined { return this.context.globalState.get("devToolsNotificationLastShown") as number; }
	set devToolsNotificationLastShown(value: number) { this.context.globalState.update("devToolsNotificationLastShown", value); }
	get devToolsNotificationDoNotShow(): boolean { return !!this.context.globalState.get("devToolsNotificationDoNotShowAgain"); }
	set devToolsNotificationDoNotShow(value: boolean) { this.context.globalState.update("devToolsNotificationDoNotShowAgain", value); }
}
