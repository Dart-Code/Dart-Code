import * as vs from "vscode";
import { DartCapabilities } from "../../../shared/capabilities/dart";
import { disposeAll } from "../../../shared/utils";
import { envUtils } from "../../../shared/vscode/utils";
import { perSessionWebviewStateKey } from "../../extension";
import { DevToolsManager } from "../../sdk/dev_tools/manager";

export abstract class MyBaseWebViewProvider implements vs.WebviewViewProvider {
	protected readonly disposables: vs.Disposable[] = [];
	public webviewView: vs.WebviewView | undefined;

	constructor(
		protected readonly devTools: DevToolsManager,
		protected readonly dartCapabilities: DartCapabilities,
	) { }

	abstract get pageName(): string;
	abstract get pageUrl(): Promise<string | null | undefined>; // undefined = no DevTools, null = just no page to display yet (still set up iframe).

	public async resolveWebviewView(webviewView: vs.WebviewView, context: vs.WebviewViewResolveContext<unknown>, token: vs.CancellationToken): Promise<void> {
		if (this.webviewView !== webviewView) {
			this.webviewView = webviewView;
			this.disposables.push(this.webviewView.webview.onDidReceiveMessage(
				async (message) => {
					if (message.command === "launchUrl") {
						await envUtils.openInBrowser(message.data.url as string);
					}
				},
			));
		}

		await this.devTools.start();
		const pageUrl = await this.pageUrl;
		if (pageUrl === undefined) { // undefined = no Devtools, null = just no page to display yet (still set up iframe).
			webviewView.webview.html = `
			<html>
			<body><h1>${this.pageName} Unavailable</h1><p>The ${this.pageName} requires DevTools but DevTools failed to start.</p></body>
			</html>
			`;
			return;
		}

		const pageScript = this.getScript();

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

		await this.setUrl(pageUrl);
	}

	public async setUrl(url: string | null) {
		if (!url)
			return;

		url = await envUtils.exposeUrl(url);
		void this.webviewView?.webview.postMessage({ command: "_dart-code.setUrl", url });
	}

	public async setHtml(content: string | null) {
		void this.webviewView?.webview.postMessage({ command: "_dart-code.setHtml", content });
	}

	public async reload() {
		void this.webviewView?.webview.postMessage({ command: "refresh" });
	}

	protected getScript() {
		const embedFlags = this.dartCapabilities.requiresDevToolsEmbedFlag ? "embed=true&embedMode=one" : "embedMode=one";

		return `
	const vscode = acquireVsCodeApi();
	const originalState = vscode.getState()?.${perSessionWebviewStateKey};
	const originalFrameUrl = originalState?.frameUrl;

	window.addEventListener('load', (event) => {
		// Restore previous frame if we had one.
		const devToolsFrame = document.getElementById('devToolsFrame');
		if (originalFrameUrl && (devToolsFrame.src === "about:blank" || devToolsFrame.src === "")) {
			console.log(\`Restoring DevTools frame \${originalFrameUrl}\`);
			devToolsFrame.src = originalFrameUrl;
		}
	});

	// Track the background color as an indicator of whether the theme changed.
	let currentBackgroundColor;

	function getTheme() {
		const isDarkMode = !document.body.classList.contains('vscode-light');
		const backgroundColor = currentBackgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-sideBar-background');
		const foregroundColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-sideBar-foreground');

		return {
			isDarkMode: isDarkMode,
			backgroundColor: backgroundColor,
			foregroundColor: foregroundColor,
		};
	}

	window.addEventListener('message', (event) => {
		const devToolsFrame = document.getElementById('devToolsFrame');
		const message = event.data;

		const theme = document.body.classList.contains('vscode-light') ? 'light': 'dark';
		const background = currentBackgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-sideBar-background');
		const foreground = getComputedStyle(document.documentElement).getPropertyValue('--vscode-sideBarTitle-foreground');
		const fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--vscode-font-family');
		const fontSize = getComputedStyle(document.documentElement).getPropertyValue('--vscode-font-size');

		// Handle any special commands first.
		switch (message.command) {
			case "_dart-code.setUrl":
				const qsSep = message.url.includes("?") ? "&" : "?";
				// Don't include # in colors
				// https://github.com/flutter/flutter/issues/155992
				let url = \`\${message.url}\${qsSep}${embedFlags}&theme=\${theme}&backgroundColor=\${encodeURIComponent(background?.replace('#', ''))}&foregroundColor=\${encodeURIComponent(foreground?.replace('#', ''))}\`;
				if (devToolsFrame.src !== url || devToolsFrame.srcdoc) {
					devToolsFrame.src = url;
					devToolsFrame.removeAttribute('srcdoc');
					vscode.setState({ ${perSessionWebviewStateKey}: { frameUrl: url } });
				}
				return;
			case "_dart-code.setHtml":
				const htmlContent = \`
					<html>
					<head>
					<style>
					body {
						background-color: \${background};
						color: \${foreground};
						font-family: \${fontFamily};
						font-size: \${fontSize};
						text-align: center;
						vertical-align: middle;
					}
					h1 {
						margin-top: 50px;
						font-size: 1.2em;
					}
					</style>
					</head>
					<body>\${message.content}</body>
					</html>
				\`;
				devToolsFrame.srcdoc = htmlContent;
				vscode.setState({ ${perSessionWebviewStateKey}: { frameUrl: undefined } });
				return;
		}

		try {
			const frameOrigin = new URL(devToolsFrame.src).origin;
			if (event.origin == frameOrigin) {
				// Messages from the frame go up to VS Code.
				// console.log(\`FRAME: Code <-- DevTools: \${JSON.stringify(message)}\`);
				vscode.postMessage(message);
			} else {
				// Messages not from the frame go to the frame.
				// console.log(\`FRAME: Code --> DevTools: \${JSON.stringify(message)}\`);
				devToolsFrame.contentWindow.postMessage(message, frameOrigin);
			}
		} catch (e) {
		 	console.log(\`Failed to proxy message: \${e}\`);
		}
	});

	function sendTheme() {
		const devToolsFrame = document.getElementById('devToolsFrame');
		const theme = getTheme();
		devToolsFrame.contentWindow.postMessage({
			method: 'editor.themeChanged',
			params: {
				kind: 'themeChanged',
				theme: theme,
			}
		}, "*");
	}

	document.addEventListener('DOMContentLoaded', function () {
		new MutationObserver((mutationList) => {
			for (const mutation of mutationList) {
				if (mutation.type === "attributes" && mutation.attributeName == "class") {
					let newBackgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-sideBar-background');
					if (newBackgroundColor !== currentBackgroundColor) {
						sendTheme();
						break;
					}
				}
			}
		}).observe(document.body, { attributeFilter : ['class'], attributeOldValue: true });
	});
			`;
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

export abstract class MySimpleBaseWebViewProvider extends MyBaseWebViewProvider {
	abstract get pageRoute(): string;

	get pageUrl(): Promise<string | undefined> {
		return this.devTools.urlFor(this.pageRoute);
	}
}
