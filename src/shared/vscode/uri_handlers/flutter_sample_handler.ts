import * as vs from "vscode";
import { FlutterCapabilities } from "../../capabilities/flutter";
import { createFlutterSampleInTempFolder } from "../flutter_samples";

export class FlutterSampleUriHandler {
	constructor(private flutterCapabilities: FlutterCapabilities) { }

	public handle(sampleID: string): void {
		if (!this.isValidSampleName(sampleID)) {
			void vs.window.showErrorMessage(`${sampleID} is not a valid Flutter sample identifier`);
			return;
		}

		createFlutterSampleInTempFolder(this.flutterCapabilities, sampleID);
	}

	private readonly validSampleIdentifierPattern = new RegExp("^[\\w\\.]+$");
	private isValidSampleName(name: string): boolean {
		return this.validSampleIdentifierPattern.test(name);
	}
}
