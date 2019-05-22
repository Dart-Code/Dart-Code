import * as vs from "vscode";
import { FlutterCapabilities } from "../flutter/capabilities";
import { createFlutterSampleInTempFolder } from "../sdk/flutter_samples";

export class FlutterSampleUriHandler {
	constructor(private flutterCapabilities: FlutterCapabilities) { }

	public async handle(sampleID: string): Promise<void> {
		if (!this.isValidSampleName(sampleID)) {
			vs.window.showErrorMessage(`${sampleID} is not a valid Flutter sample identifier`);
			return;
		}

		createFlutterSampleInTempFolder(this.flutterCapabilities, sampleID);
	}

	private readonly validSampleIdentifierPattern = new RegExp("^[\\w\\.]+$");
	private isValidSampleName(name: string): boolean {
		return this.validSampleIdentifierPattern.test(name);
	}
}
