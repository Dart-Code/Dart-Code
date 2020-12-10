import { FlutterCapabilities } from "../capabilities/flutter";

export function getFutterWebRendererArg(flutterCapabilities: FlutterCapabilities, renderer: "default" | "auto" | "html" | "canvaskit", existingArgs: string[] | undefined) {
	if (!flutterCapabilities.supportsWebRendererOption)
		return;

	if (!renderer || renderer === "default")
		return;

	const alreadyHasArg = existingArgs?.find((a) => a.startsWith("--web-renderer=") || a === "--web-renderer");
	if (alreadyHasArg)
		return;

	return `--web-renderer=${renderer}`;
}
