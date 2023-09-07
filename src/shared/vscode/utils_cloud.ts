export function isTheia(appName: string | undefined) {
	return appName?.includes("Theia");
}

export function isCloudShell(appName: string | undefined) {
	return appName?.includes("Cloud Shell");
}

export function isProjectIdx(appName: string | undefined) {
	return appName?.includes("IDX");
}

export function isKnownCloudIde(appName: string | undefined) {
	return isTheia(appName) || isCloudShell(appName) || isProjectIdx(appName);
}
