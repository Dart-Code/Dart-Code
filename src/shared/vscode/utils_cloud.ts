import * as vs from "vscode";

export const isTheia = vs.env.appName?.includes("Theia") ?? false;
export const isCloudShell = vs.env.appName?.includes("Cloud Shell") ?? false;
export const isKnownCloudIde = isTheia || isCloudShell;

export function generateDwdsAuthRedirectUrl({ url, debugServiceBackendUri }: { url: string; debugServiceBackendUri: string; }): string {
	const backendUri = vs.Uri.parse(debugServiceBackendUri);

	return backendUri.with({
		path: "/$redir",
		query: `url=${encodeURIComponent(url)}`,
		scheme: backendUri.scheme.replace(/^ws/, "http"),
	}).toString();
}
