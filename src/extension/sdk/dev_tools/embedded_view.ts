import * as vs from "vscode";
import { Event, EventEmitter } from "../../../shared/events";
import { DevToolsPage } from "../../../shared/interfaces";
import { envUtils, firstNonEditorColumn } from "../../../shared/vscode/utils";
import { DartDebugSessionInformation } from "../../utils/vscode/debug";

const pageScript = `
const vscode = acquireVsCodeApi();
window.addEventListener('message', (event) => {
	const message = event.data;
	const devToolsFrame = document.getElementById('devToolsFrame');
	switch (message.command) {
		case "setUrl":
			const theme = document.body.classList.contains('vscode-light') ? 'light': 'dark';
			const background = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background');
			const foreground = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-foreground');
			let url = \`\${message.url}&theme=\${theme}&backgroundColor=\${encodeURIComponent(background)}&foregroundColor=\${encodeURIComponent(foreground)}\`;
			const fontSizeWithUnits = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-font-size');
			if (fontSizeWithUnits && fontSizeWithUnits.endsWith('px')) {
				url += \`&fontSize=\${encodeURIComponent(parseFloat(fontSizeWithUnits))}\`;
			}
			if (devToolsFrame.src !== url)
				devToolsFrame.src = url;
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
`;

const scriptNonce = Buffer.from(pageScript).toString("base64");
const frameCss = "position: absolute; top: 0; left: 0; width: 100%; height: 100%";
const cssNonce = Buffer.from(frameCss).toString("base64");

export class DevToolsEmbeddedView {
	private readonly panel: vs.WebviewPanel;
	private onDisposeEmitter: EventEmitter<void> = new EventEmitter<void>();
	private messageDisposable: vs.Disposable;
	public readonly onDispose: Event<void> = this.onDisposeEmitter.event;

	constructor(public session: DartDebugSessionInformation, readonly devToolsUri: string, readonly page: DevToolsPage, location: "beside" | "active" | undefined) {
		const column = location === "active"
			? vs.ViewColumn.Active
			: (firstNonEditorColumn() ?? vs.ViewColumn.Beside);
		this.panel = vs.window.createWebviewPanel("dartDevTools", page.title, column, {
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
			<body><iframe id="devToolsFrame" src="about:blank" frameborder="0" allow="clipboard-read; clipboard-write"></iframe></body>
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

	public load(session: DartDebugSessionInformation, uri: string): void {
		this.session = session;
		void this.panel.webview.postMessage({ command: "setUrl", url: uri });
		this.panel.reveal();
	}

	private dispose(panelDisposed = false): void {
		if (!panelDisposed)
			this.panel.dispose();
		this.onDisposeEmitter.fire();
		this.messageDisposable.dispose();
	}
}
