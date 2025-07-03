
import * as vs from "vscode";
import { DartFileCoverageDetail } from "../test/coverage";

export class DartFileCoverage extends vs.FileCoverage {
	constructor(uri: vs.Uri, public readonly detail: DartFileCoverageDetail) {
		super(uri, new vs.TestCoverageCount(detail.coveredLines.size, detail.coverableLines.size));
	}
}
