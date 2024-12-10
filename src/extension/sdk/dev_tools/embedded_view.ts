import * as vs from "vscode";
import { Event, EventEmitter } from "../../../shared/events";
import { IAmDisposable } from "../../../shared/interfaces";
import { envUtils, firstNonEditorColumn } from "../../../shared/vscode/utils";
import { perSessionWebviewStateKey } from "../../extension";
import { DartDebugSessionInformation } from "../../utils/vscode/debug";

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

window.addEventListener('load', (event) => {
	// Restore previous frame if we had one.
	const devToolsFrame = document.getElementById('devToolsFrame');
	if (originalFrameUrl && (devToolsFrame.src === "about:blank" || devToolsFrame.src === "")) {
		console.log(\`Restoring DevTools frame \${originalFrameUrl}\`);
		devToolsFrame.src = originalFrameUrl;
	}
});
window.addEventListener('message', (event) => {
	const message = event.data;
	const devToolsFrame = document.getElementById('devToolsFrame');
	switch (message.command) {
		case "setUrl":
			const theme = getTheme();
			const themeKind = theme.isDarkMode ? 'dark' : 'light';
			// Don't include # in colors
			// https://github.com/flutter/flutter/issues/155992
			let url = \`\${message.url}&theme=\${themeKind}&backgroundColor=\${encodeURIComponent(theme.backgroundColor?.replace('#', ''))}&foregroundColor=\${encodeURIComponent(theme.foregroundColor?.replace('#', ''))}\`;
			if (devToolsFrame.src !== url) {
				devToolsFrame.src = url;
				vscode.setState({ ${perSessionWebviewStateKey}: { frameUrl: url } });
			}
			break;
		case "refresh":
			devToolsFrame.src += '';
			break;
		case "keydown":
			const data = message.data;
			// Forward keypresses up to VS Code so you can access the palette etc.
			// https://github.com/flutter/devtools/issues/2775
			// But suppress if it looks like SelectAll because we never want to handle that.
			// https://github.com/flutter/devtools/issues/5107
			const isSelectAll = data.code === 'KeyA' && (data.ctrlKey || data.metaKey);
			if (!isSelectAll)
				window.dispatchEvent(new KeyboardEvent('keydown', data));
			break;
		case "launchUrl":
			vscode.postMessage({command: 'launchUrl', data: message.data});
			break;
		case "clipboard-write":
			const copyData = message.data;
			navigator.clipboard.writeText(copyData);
			break;
	}
});
window.addEventListener('keydown', (event) => {
	// Move focus back into Frame. This happens if the frame has focus and you tab
	// away from VS Code, then back. The focus moves to this container page, and not
	// the DevTools iframe.
	if (document.activeElement == document.body)
		devToolsFrame?.contentWindow.focus();
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

const scriptNonce = Buffer.from(pageScript).toString("base64");
const frameCss = "position: absolute; top: 0; left: 0; width: 100%; height: 100%";
const cssNonce = Buffer.from(frameCss).toString("base64");

export abstract class DevToolsEmbeddedViewOrSidebarView implements IAmDisposable {
	private onDisposeEmitter: EventEmitter<void> = new EventEmitter<void>();

	public readonly onDispose: Event<void> = this.onDisposeEmitter.event;
	public openedAutomatically = false;

	constructor(public session: DartDebugSessionInformation | undefined) { }

	abstract setUrl(url: string): void;
	abstract reload(): void;

	public load(session: DartDebugSessionInformation | undefined, url: string): void {
		this.session = session;
		this.setUrl(url);
	}

	public dispose(): void {
		this.onDisposeEmitter.fire();
	}
}


export class DevToolsEmbeddedView extends DevToolsEmbeddedViewOrSidebarView {
	private readonly panel: vs.WebviewPanel;
	private messageDisposable: vs.Disposable;

	constructor(session: DartDebugSessionInformation | undefined, readonly devToolsUri: string, readonly pageTitle: string, location: "beside" | "active" | undefined) {
		super(session);

		const column = location === "active"
			? vs.ViewColumn.Active
			: (firstNonEditorColumn() ?? vs.ViewColumn.Beside);
		this.panel = vs.window.createWebviewPanel("dartDevTools", pageTitle, column, {
			enableScripts: true,
			localResourceRoots: [],
			retainContextWhenHidden: true,
		});
		this.panel.onDidDispose(() => this.dispose(true));

		this.panel.webview.html = `
			<html>
			<head>
			<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'nonce-${scriptNonce}' 'nonce-${cssNonce}' http://${vs.Uri.parse(devToolsUri).authority};">
			<script nonce="${scriptNonce}">${pageScript}</script>
			<style nonce="${cssNonce}">#devToolsFrame { ${frameCss} }</style>
			</head>
			<body><iframe id="devToolsFrame" src="about:blank" frameborder="0" allow="clipboard-read; clipboard-write; cross-origin-isolated"></iframe></body>
			</html>
			`;

		this.messageDisposable = this.panel.webview.onDidReceiveMessage(
			async (message) => {
				if (message.command === "launchUrl") {
					await envUtils.openInBrowser(message.data.url as string);
				}
			},
		);
	}

	public setUrl(url: string): void {
		void this.panel.webview.postMessage({ command: "setUrl", url });
		this.panel.reveal();
	}

	public reload(): void {
		void this.panel.webview.postMessage({ command: "refresh" });
	}


	public dispose(panelDisposed = false): void {
		if (!panelDisposed)
			this.panel.dispose();
		this.messageDisposable.dispose();
		super.dispose();
	}
}


