import { envUtils } from "../../shared/vscode/utils";
import { requiresAuthIframes } from "../../shared/vscode/utils_cloud";

export const handleUrlAuthFunction = `
	async function handleUrlAuth(urls) {
		try {
			if (!urls)
				return;

			const promises = urls.map((url) => new Promise((resolve) => {
				let done = false;
				let timeoutId;
				const iframe = document.createElement("iframe");
				iframe.src = url;
				iframe.style.display = "none";

				function cleanupAndResolve() {
					if (done) return;
					done = true;
					clearTimeout(timeoutId);
					iframe.remove();
					resolve();
				};

				iframe.onload = cleanupAndResolve;
				iframe.onerror = cleanupAndResolve;
				// 5s timeout so we don't wait forever if there's no response.
				timeoutId = setTimeout(cleanupAndResolve, 5000);

				// Add the frame to start the load.
				document.body.appendChild(iframe);
			}));

			// Wait for all the individual promises to complete concurrently.
			await Promise.all(promises);
		} catch (e) {
		 	// Just log an errors, we never want to prevent trying to load the real view.
			console.warn(e);
		}
	}
`;

/// A URL to show in a webview, along with additional URLs that might need to first be run through a hidden iframe
/// to trigger authentication.
export interface WebViewUrls {
	viewUrl: string;
	authUrls: string[] | undefined;
}

/// Exposes all URLs through envUtils.exposeUrl and maps the auth URLs onto the necessary
/// HTTP(S) urls for using in the auth iframe.
///
/// If the current platform doesn't require auth URLs, authUrls will be dropped.
export async function exposeWebViewUrls(urls: WebViewUrls): Promise<WebViewUrls> {
	return {
		viewUrl: await envUtils.exposeUrl(urls.viewUrl),
		authUrls: urls.authUrls?.length && requiresAuthIframes()
			? await Promise.all(urls.authUrls.map(computeAuthFrameUri).map((url) => envUtils.exposeUrl(url)))
			: undefined,
	};
}

/// Given a string like wss://12345-firebase-test-connect-1234567.cluster-abcdef.cloudworkstations.dev/iN6zXu7VpYc=/ws
/// returns a HTTP(S) url like https://12345-firebase-test-connect-1234567.cluster-abcdef.cloudworkstations.dev/iN6zXu7VpYc=/ws
/// that can be used inside a hidden iframe to trigger auth cookies so that client apps like DevTools can connect over WebSockets.
export function computeAuthFrameUri(urlString: string): string {
	let uri: URL;
	try {
		uri = new URL(urlString);
	} catch {
		return urlString;
	}

	if (uri.protocol === "wss:")
		uri.protocol = "https";
	else if (uri.protocol === "ws:")
		uri.protocol = "http";
	uri.pathname = "";

	return uri.toString();
}
