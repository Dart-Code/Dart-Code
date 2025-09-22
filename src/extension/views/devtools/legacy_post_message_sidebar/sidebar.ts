import * as vs from "vscode";
import { URI } from "vscode-uri";
import { DartCapabilities } from "../../../../shared/capabilities/dart";
import { CommandSource } from "../../../../shared/constants";
import { IAmDisposable } from "../../../../shared/interfaces";
import { disposeAll } from "../../../../shared/utils";
import { FlutterDeviceManager } from "../../../../shared/vscode/device_manager";
import { envUtils } from "../../../../shared/vscode/utils";
import { DevToolsManager } from "../../../sdk/dev_tools/manager";
import { DartApi } from "./dart_tooling_api";

export class FlutterPostMessageSidebar implements IAmDisposable {
	protected readonly disposables: vs.Disposable[] = [];

	constructor(
		readonly devTools: DevToolsManager,
		readonly deviceManager: FlutterDeviceManager | undefined,
		dartCapabilities: DartCapabilities,
	) {
		const webViewProvider = new MyWebViewProvider(devTools, deviceManager, dartCapabilities);
		this.disposables.push(webViewProvider);
		this.disposables.push(vs.window.registerWebviewViewProvider("dartFlutterSidebar", webViewProvider, { webviewOptions: { retainContextWhenHidden: true } }));
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

class MyWebViewProvider implements vs.WebviewViewProvider, IAmDisposable {
	protected readonly disposables: vs.Disposable[] = [];

	public webviewView: vs.WebviewView | undefined;
	private api: DartApi | undefined;
	constructor(
		private readonly devTools: DevToolsManager,
		private readonly deviceManager: FlutterDeviceManager | undefined,
		private readonly dartCapabilities: DartCapabilities,
	) { }

	public dispose(): any {
		this.api?.dispose();
		disposeAll(this.disposables);
	}

	public async resolveWebviewView(webviewView: vs.WebviewView, _context: vs.WebviewViewResolveContext<unknown>, _token: vs.CancellationToken): Promise<void> {
		this.webviewView = webviewView;
		this.api?.dispose();

		await this.devTools.start();
		let sidebarUrl = await this.devTools.urlFor("vsCodeFlutterPanel");
		if (!sidebarUrl) {
			webviewView.webview.html = `
			<html>
			<body><h1>Sidebar Unavailable</h1><p>The Flutter sidebar requires DevTools but DevTools failed to start.</p></body>
			</html>
			`;
			return;
		}

		sidebarUrl = await envUtils.exposeUrl(sidebarUrl);
		const sidebarUri = URI.parse(sidebarUrl);
		const frameOrigin = `${sidebarUri.scheme}://${sidebarUri.authority}`;
		const embedFlags = this.dartCapabilities.requiresDevToolsEmbedFlag ? "embed=true&embedMode=one" : "embedMode=one";

		// TODO(dantup): Consolidate this script with the two others into a local
		//  .js file that can be referenced, so we don't have to embed inside a string.
		const pageScript = `
		let currentBackgroundColor;
		let currentBaseUrl;

		function setIframeSrc() {
			const devToolsFrame = document.getElementById('devToolsFrame');
			const theme = document.body.classList.contains('vscode-light') ? 'light': 'dark';
			const background = currentBackgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-sideBar-background');
			const foreground = getComputedStyle(document.documentElement).getPropertyValue('--vscode-sideBarTitle-foreground');
			const qsSep = currentBaseUrl.includes("?") ? "&" : "?";
			// Don't include # in colors
			// https://github.com/flutter/flutter/issues/155992
			let url = \`\${currentBaseUrl}\${qsSep}${embedFlags}&theme=\${theme}&backgroundColor=\${encodeURIComponent(background?.replace('#', ''))}&foregroundColor=\${encodeURIComponent(foreground?.replace('#', ''))}\`;
			if (devToolsFrame.src !== url)
				devToolsFrame.src = url;
		}

		const vscode = acquireVsCodeApi();
		window.addEventListener('message', async (event) => {
			const devToolsFrame = document.getElementById('devToolsFrame');
			const message = event.data;

			// Handle any special commands first.
			switch (message.command) {
				case "_dart-code.setUrl":
					currentBaseUrl = message.url;
					setIframeSrc();
					return;
			}

			if (event.origin == ${JSON.stringify(frameOrigin)}) {
				// Messages from the frame go up to VS Code.
				// console.log(\`FRAME: Code <-- DevTools: \${JSON.stringify(message)}\`);
				vscode.postMessage(message);
			} else {
				// Messages not from the frame go to the frame.
				// console.log(\`FRAME: Code --> DevTools: \${JSON.stringify(message)}\`);
				devToolsFrame.contentWindow.postMessage(message, ${JSON.stringify(frameOrigin)});
			}
		});

		document.addEventListener('DOMContentLoaded', function () {
			new MutationObserver((mutationList) => {
				for (const mutation of mutationList) {
					if (mutation.type === "attributes" && mutation.attributeName === "class") {
						let newBackgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-sideBar-background');
						if (newBackgroundColor !== currentBackgroundColor) {
							setIframeSrc();
						}
					}
				}
			}).observe(document.body, { attributeFilter : ['class'], attributeOldValue: true });
		});
		`;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [],
		};

		webviewView.webview.html = `
			<html>
			<head>
			<meta http-equiv="Content-Security-Policy" content="default-src *; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
			<script>${pageScript}</script>
			</head>
			<body><iframe id="devToolsFrame" src="about:blank" frameborder="0" allow="clipboard-read; clipboard-write; cross-origin-isolated" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%"></iframe></body>
			</html>
			`;

		this.api = new DartApi(
			CommandSource.sidebarContent,
			webviewView.webview.onDidReceiveMessage,
			(message) => webviewView.webview.postMessage(message),
			this.deviceManager,
		);

		void webviewView.webview.postMessage({ command: "_dart-code.setUrl", url: sidebarUrl });
	}

}

