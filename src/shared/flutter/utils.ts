import { FlutterCapabilities } from "../capabilities/flutter";

export function getFutterWebRenderer(flutterCapabilities: FlutterCapabilities, renderer: "auto" | "html" | "canvaskit") {
	if (!flutterCapabilities.supportsWebRendererOption)
		return;

	if (!renderer || renderer === "auto")
		return;

	return renderer;
}
