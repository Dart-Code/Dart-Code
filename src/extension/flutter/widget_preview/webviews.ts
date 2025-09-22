import * as vs from "vscode";
import { SIDEBAR_AVAILABLE_PREFIX } from "../../../shared/constants.contexts";
import { Event, EventEmitter } from "../../../shared/events";
import { IAmDisposable } from "../../../shared/interfaces";
import { disposeAll } from "../../../shared/utils";
import { firstNonEditorColumn } from "../../../shared/vscode/utils";
import { perSessionWebviewStateKey } from "../../extension";
import { handleUrlAuthFunction, WebViewUrls } from "../../views/shared";

// TODO(dantup): Consider if we need to handle keydown/launchUrl/clipboard-write as in DevTools?
//  They would first need implementing in the widget preview to pass up via postMessage.

const pageScript = `
const vscode = acquireVsCodeApi();
const originalState = vscode.getState()?.${perSessionWebviewStateKey};
const originalFrameUrl = originalState?.frameUrl;

// Track the background color as an indicator of whether the theme changed.
let currentBackgroundColor;

function getTheme() {
	const isDarkMode = !document.body.classList.contains('vscode-light');
	const backgroundColor = currentBackgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background');
	const foregroundColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-foreground');

	return {
		isDarkMode: isDarkMode,
		backgroundColor: backgroundColor,
		foregroundColor: foregroundColor,
	};
}

${handleUrlAuthFunction}

window.addEventListener('load', (event) => {
	// Restore previous frame if we had one.
	const widgetPreviewFrame = document.getElementById('widgetPreviewFrame');
	if (originalFrameUrl && (widgetPreviewFrame.src === "about:blank" || widgetPreviewFrame.src === "")) {
		console.log(\`Restoring Widget Preview frame \${originalFrameUrl}\`);
		widgetPreviewFrame.src = originalFrameUrl;
	}
});

window.addEventListener('message', async (event) => {
	const message = event.data;
	const widgetPreviewFrame = document.getElementById('widgetPreviewFrame');
	switch (message.command) {
		case "setUrls":
			await setUrls(message.urls);
			break;
	}
});

async function setUrls(urls) {
	const theme = getTheme();
	const themeKind = theme.isDarkMode ? 'dark' : 'light';
	// Don't include # in colors
	// https://github.com/flutter/flutter/issues/155992
	const separator = urls.viewUrl.includes('?') ? '&' : '?';
	let url = \`\${urls.viewUrl}\${separator}theme=\${themeKind}&backgroundColor=\${encodeURIComponent(theme.backgroundColor?.replace('#', ''))}&foregroundColor=\${encodeURIComponent(theme.foregroundColor?.replace('#', ''))}\`;
	if (widgetPreviewFrame.src !== url) {
		await handleUrlAuth(urls.authUrls);
		widgetPreviewFrame.src = url;
		vscode.setState({ ${perSessionWebviewStateKey}: { frameUrl: url } });
	}
}

function sendTheme() {
	const widgetPreviewFrame = document.getElementById('widgetPreviewFrame');
	const theme = getTheme();
	widgetPreviewFrame.contentWindow.postMessage({
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
			if (mutation.type === "attributes" && mutation.attributeName === "class") {
				let newBackgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background');
				if (newBackgroundColor !== currentBackgroundColor) {
					sendTheme();
					break;
				}
			}
		}
	}).observe(document.body, { attributeFilter : ['class'], attributeOldValue: true });
});
`;

const frameCss = "position: absolute; top: 0; left: 0; width: 100%; height: 100%";
const cssNonce = Buffer.from(frameCss).toString("base64");

function getPageHtmlSource(widgetPreviewUris: WebViewUrls): string {
	const fullPageScript = `
	${pageScript}
	window.addEventListener('load', (event) => setUrls(${JSON.stringify(widgetPreviewUris)}));
	`;
	const scriptNonce = Buffer.from(fullPageScript).toString("base64");
	return `
		<html>
		<head>
		<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'nonce-${scriptNonce}' 'nonce-${cssNonce}' http://${vs.Uri.parse(widgetPreviewUris.viewUrl).authority}; frame-src *;">
		<script nonce="${scriptNonce}">${fullPageScript}</script>
		<style nonce="${cssNonce}">#widgetPreviewFrame { ${frameCss} }</style>
		</head>
		<body><iframe id="widgetPreviewFrame" src="about:blank" frameborder="0" allow="clipboard-read; clipboard-write; cross-origin-isolated"></iframe></body>
		</html>
	`;
}

export abstract class WidgetPreviewView implements IAmDisposable {
	private onDisposeEmitter: EventEmitter<void> = new EventEmitter<void>();
	public readonly onDispose: Event<void> = this.onDisposeEmitter.event;

	abstract show(): void;

	public dispose(): void {
		this.onDisposeEmitter.fire();
	}
}

export class WidgetPreviewEmbeddedView extends WidgetPreviewView {
	private readonly panel: vs.WebviewPanel;

	constructor(readonly widgetPreviewUri: WebViewUrls, readonly pageTitle: string) {
		super();

		const column = firstNonEditorColumn() ?? vs.ViewColumn.Beside;
		this.panel = vs.window.createWebviewPanel("dartWidgetPreview", pageTitle, column, {
			enableScripts: true,
			localResourceRoots: [],
			retainContextWhenHidden: true,
		});
		this.panel.onDidDispose(() => this.dispose(true));

		this.panel.webview.html = getPageHtmlSource(widgetPreviewUri);
	}

	public show(): void {
		this.panel.reveal();
	}

	public dispose(panelDisposed = false): void {
		if (!panelDisposed)
			this.panel.dispose();
		super.dispose();
	}
}

export class WidgetPreviewSidebarView extends WidgetPreviewView {
	protected readonly disposables: vs.Disposable[] = [];
	protected readonly webViewProvider: WidgetPreviewSidebarViewProvider;

	constructor(
		private readonly previewUrls: WebViewUrls,
	) {
		super();

		void vs.commands.executeCommand("setContext", `${SIDEBAR_AVAILABLE_PREFIX}widgetPreview`, true);
		this.webViewProvider = new WidgetPreviewSidebarViewProvider(this.previewUrls);
		this.disposables.push(this.webViewProvider);
		this.disposables.push(vs.window.registerWebviewViewProvider(`sidebarWidgetPreview`, this.webViewProvider, { webviewOptions: { retainContextWhenHidden: true } }));
	}

	public show(): void {
		void vs.commands.executeCommand(`sidebarWidgetPreview.focus`);
		this.webViewProvider.webviewView?.show(true);
	}

	public dispose(): void {
		disposeAll(this.disposables);
	}
}

class WidgetPreviewSidebarViewProvider implements vs.WebviewViewProvider {
	protected readonly disposables: vs.Disposable[] = [];
	public webviewView: vs.WebviewView | undefined;

	constructor(
		private readonly previewUrls: WebViewUrls
	) { }

	public async resolveWebviewView(webviewView: vs.WebviewView, _context: vs.WebviewViewResolveContext<unknown>, _token: vs.CancellationToken): Promise<void> {
		if (this.webviewView !== webviewView) {
			this.webviewView = webviewView;
		}

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [],
		};

		webviewView.webview.html = getPageHtmlSource(this.previewUrls);
	}

	public dispose(): void {
		disposeAll(this.disposables);
	}
}
