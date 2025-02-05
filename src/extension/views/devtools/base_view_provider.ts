import * as vs from "vscode";
import { DartCapabilities } from "../../../shared/capabilities/dart";
import { envUtils } from "../../../shared/vscode/utils";
import { DevToolsManager } from "../../sdk/dev_tools/manager";


export abstract class MyBaseWebViewProvider implements vs.WebviewViewProvider {
	public webviewView: vs.WebviewView | undefined;
	constructor(
		private readonly devTools: DevToolsManager,
		private readonly dartCapabilities: DartCapabilities,
	) { }

	abstract get pageName(): string;
	abstract get pageRoute(): string;

	public async resolveWebviewView(webviewView: vs.WebviewView, context: vs.WebviewViewResolveContext<unknown>, token: vs.CancellationToken): Promise<void> {
		this.webviewView = webviewView;

		await this.devTools.start();
		let pageUrl = await this.devTools.urlFor(this.pageRoute);
		if (!pageUrl) {
			webviewView.webview.html = `
			<html>
			<body><h1>${this.pageName} Unavailable</h1><p>The ${this.pageName} requires DevTools but DevTools failed to start.</p></body>
			</html>
			`;
			return;
		}

		pageUrl = await envUtils.exposeUrl(pageUrl);
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

		void webviewView.webview.postMessage({ command: "_dart-code.setUrl", url: pageUrl });
	}

	protected getScript() {
		const embedFlags = this.dartCapabilities.requiresDevToolsEmbedFlag ? "embed=true&embedMode=one" : "embedMode=one";

		return `
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

	const vscode = acquireVsCodeApi();
	window.addEventListener('message', (event) => {
		const devToolsFrame = document.getElementById('devToolsFrame');
		const message = event.data;

		// Handle any special commands first.
		switch (message.command) {
			case "_dart-code.setUrl":
				const theme = document.body.classList.contains('vscode-light') ? 'light': 'dark';
				const background = currentBackgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-sideBar-background');
				const foreground = getComputedStyle(document.documentElement).getPropertyValue('--vscode-sideBarTitle-foreground');
				const qsSep = message.url.includes("?") ? "&" : "?";
				// Don't include # in colors
				// https://github.com/flutter/flutter/issues/155992
				let url = \`\${message.url}\${qsSep}${embedFlags}&theme=\${theme}&backgroundColor=\${encodeURIComponent(background?.replace('#', ''))}&foregroundColor=\${encodeURIComponent(foreground?.replace('#', ''))}\`;
				if (devToolsFrame.src !== url)
					devToolsFrame.src = url;
				return;
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
}
