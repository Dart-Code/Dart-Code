import * as vs from "vscode";

export class DartExtensionApi {
	public readonly version = 1;
	public flutterCreateSampleProject = () => vs.commands.executeCommand("_dart.flutter.createSampleProject");
}
