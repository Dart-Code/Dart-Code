import { FlutterCapabilities } from "../capabilities/flutter";

export function getFutterWebRenderer(_flutterCapabilities: FlutterCapabilities, renderer: "flutter-default" | "canvaskit" | "html" | "auto") {
	if (!renderer || renderer === "flutter-default")
		return;

	return renderer;
}
