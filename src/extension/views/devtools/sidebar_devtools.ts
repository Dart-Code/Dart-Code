import * as vs from "vscode";
import { DartCapabilities } from "../../../shared/capabilities/dart";
import { CommandSource } from "../../../shared/constants";
import { SIDEBAR_DEVTOOLS_AVAILABLE_PREFIX } from "../../../shared/constants.contexts";
import { DevToolsPage } from "../../../shared/interfaces";
import { disposeAll } from "../../../shared/utils";
import { DevToolsEmbeddedViewOrSidebarView } from "../../sdk/dev_tools/embedded_view";
import { DevToolsManager } from "../../sdk/dev_tools/manager";
import { WebViewUrls } from "../shared";
import { MyBaseWebViewProvider } from "./base_view_provider";

export class SidebarDevTools extends DevToolsEmbeddedViewOrSidebarView {
	protected readonly disposables: vs.Disposable[] = [];
	protected readonly webViewProvider: MyWebViewProvider;

	/// Whether the frame has ever been loaded.
	///
	/// We never unload, so once an iframe is shown, it will remain
	/// live. However, we may use the iframe srcdoc to unload DevTools
	/// for non-static tools when there is no debug session.
	///
	/// TODO(dantup): Consider if we need to ever support unloading static tools.
	private isLoaded = false;

	private targetUrls: WebViewUrls | undefined;

	private readonly notConnectedHtml = `
	<h1>Not Connected</h1>
	<p>Run a new debug session to connect</p>
	`;

	constructor(
		readonly page: DevToolsPage,
		readonly devTools: DevToolsManager,
		readonly dartCapabilities: DartCapabilities,
	) {
		super(undefined);

		void vs.commands.executeCommand("setContext", `${SIDEBAR_DEVTOOLS_AVAILABLE_PREFIX}${this.page.id}`, true);
		this.webViewProvider = new MyWebViewProvider(this, this.page.title, devTools, dartCapabilities);
		this.disposables.push(this.webViewProvider);
		this.disposables.push(vs.window.registerWebviewViewProvider(`sidebarDevTools${this.page.commandSuffix}`, this.webViewProvider, { webviewOptions: { retainContextWhenHidden: true } }));

	}

	/// Fired when the view is shown. If we had delayed setting the URL into the frame,
	/// we must do it now. This allows us to call setUrls() for something like inspector when
	/// a debug session starts, without it loading DevTools if the view is not visible.
	public async onShown(): Promise<void> {
		if (this.isLoaded)
			return;
		this.isLoaded = true;

		// The first time we show static tools, we load them.
		if (this.page.isStaticTool) {
			void this.devTools.spawn(undefined, { pageId: this.page.id, location: "sidebar", commandSource: CommandSource.onSidebarShown }, false);
		} else {
			// For non-static tools, we'll either show a message, or the URL we have.
			if (this.targetUrls)
				await this.setUrls(this.targetUrls, false);
			else
				this.unload(); // Show unloaded message.
		}
	}

	public unload() {
		// Static tools stay loaded all the time.
		if (this.page.isStaticTool)
			return;

		void this.webViewProvider.setHtml(this.notConnectedHtml);
	}

	public async setUrls(urls: WebViewUrls, forceShow: boolean): Promise<void> {
		this.targetUrls = urls;

		// If we're not loaded and not force-showing, we only store the URL for later.
		if (!this.isLoaded && !forceShow)
			return;

		await this.webViewProvider.setUrls(urls);
		if (forceShow) {
			await vs.commands.executeCommand(`sidebarDevTools${this.page.commandSuffix}.focus`);
			this.webViewProvider.webviewView?.show(true);
		}
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
		private readonly sidebar: SidebarDevTools,
		private readonly name: string,
		readonly devTools: DevToolsManager,
		readonly dartCapabilities: DartCapabilities,
	) {
		super(devTools, dartCapabilities);
	}

	public async resolveWebviewView(webviewView: vs.WebviewView, context: vs.WebviewViewResolveContext<unknown>, token: vs.CancellationToken): Promise<void> {
		await super.resolveWebviewView(webviewView, context, token);
		void this.sidebar.onShown();
	}

	get pageName(): string {
		return this.name;
	}

	get pageUrls(): Promise<WebViewUrls | null | undefined> {
		// We don't have this to start with, setUrls must be called.
		return Promise.resolve(null);
	}
}
