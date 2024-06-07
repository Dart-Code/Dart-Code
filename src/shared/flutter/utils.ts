import { FlutterCapabilities } from "../capabilities/flutter";

export function getFutterWebRenderer(flutterCapabilities: FlutterCapabilities, renderer: "flutter-default" | "canvaskit" | "html" | "auto") {
	if (!flutterCapabilities.supportsWebRendererOption)
		return;

	if (!renderer || renderer === "flutter-default")
		return;

	return renderer;
}
