import { FlutterCapabilities } from "../capabilities/flutter";

export function getFutterWebRenderer(flutterCapabilities: FlutterCapabilities, renderer: "canvaskit" | "html" | "auto") {
	if (!flutterCapabilities.supportsWebRendererOption)
		return;

	if (!renderer)
		return;

	return renderer;
}
