import * as vs from "vscode";
import { DartCapabilities } from "../../../shared/capabilities/dart";
import { devToolsPages } from "../../../shared/constants";
import { SIDEBAR_DEVTOOLS_AVAILABLE_PREFIX } from "../../../shared/constants.contexts";
import { DevToolsPage } from "../../../shared/interfaces";
import { disposeAll } from "../../../shared/utils";
import { DevToolsEmbeddedViewOrSidebarView } from "../../sdk/dev_tools/embedded_view";
import { DevToolsManager } from "../../sdk/dev_tools/manager";
import { DartDebugSessionInformation } from "../../utils/vscode/debug";
import { MyBaseWebViewProvider } from "./base_view_provider";

export class SidebarDevTools extends DevToolsEmbeddedViewOrSidebarView {
	protected readonly disposables: vs.Disposable[] = [];
	protected readonly webViewProvider: MyWebViewProvider;
	protected readonly page: DevToolsPage;

	static isSupportedPage(pageId: string): boolean {
		return !!devToolsPages.find((p) => p.id === pageId);
	}

	constructor(
		readonly pageId: string,
		readonly devTools: DevToolsManager,
		readonly dartCapabilities: DartCapabilities,
	) {
		super(undefined);

		this.page = devToolsPages.find((p) => p.id === pageId)!;
		this.webViewProvider = new MyWebViewProvider(this.page.title, devTools, dartCapabilities);
		this.disposables.push(vs.window.registerWebviewViewProvider(`sidebarDevTools${this.page.commandSuffix}`, this.webViewProvider, { webviewOptions: { retainContextWhenHidden: true } }));
	}

	public load(session: DartDebugSessionInformation | undefined, url: string): void {
		void vs.commands.executeCommand("setContext", `${SIDEBAR_DEVTOOLS_AVAILABLE_PREFIX}${this.pageId}`, true);
		super.load(session, url);
	}

	public async setUrl(url: string): Promise<void> {
		await vs.commands.executeCommand(`sidebarDevTools${this.page.commandSuffix}.focus`);
		this.webViewProvider.webviewView?.show(true);
		await this.webViewProvider.setUrl(url);
	}

	public async reload(): Promise<void> {
		await this.webViewProvider.reload();
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

class MyWebViewProvider extends MyBaseWebViewProvider {
	constructor(
		private readonly name: string,
		readonly devTools: DevToolsManager,
		readonly dartCapabilities: DartCapabilities,
	) {
		super(devTools, dartCapabilities);
	}

	get pageName(): string {
		return this.name;
	}

	get pageUrl(): Promise<string | null | undefined> {
		// We don't have this to start with, setUrl must be called.
		return Promise.resolve(null);
	}
}
