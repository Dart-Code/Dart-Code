import * as fs from "fs";
import { Logger } from "../interfaces";

export class CoverageParser {
	constructor(private readonly logger: Logger) { }

	public parseLcovFile(lcovFilePath: string): DartFileCoverageDetail[] {
		try {
			const lcovContent = fs.readFileSync(lcovFilePath).toString();
			return this.parseLcovContent(lcovContent);

		} catch (e) {
			this.logger.error(`Failed to read expected coverage file "${lcovFilePath}": ${e}`);
			return [];
		}
	}

	public parseLcovContent(content: string): DartFileCoverageDetail[] {
		return content.split(/\nend_of_record(?:\r?\n|$)/)
			.map((r) => r.trim()) // Remove whitespace
			.filter((r) => !!r) // Remove empty records
			.map(this.parseLcovRecord.bind(this)) // Parse
			.filter((r) => !!r); // Remove empty/invalid results
	}

	public parseLcovRecord(record: string): DartFileCoverageDetail | undefined {
		let sourceFilePath: string | undefined;
		const coverableLines = new Set<number>();
		const coveredLines = new Set<number>();

		function recordLine(lineNumber: number, taken: number) {
			coverableLines.add(lineNumber);
			if (taken > 0) {
				coveredLines.add(lineNumber);
			}
		}

		for (const line of record.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"))) {
			// Don't _split_ on colons because we might have Windows paths on the right.
			const colon = line.indexOf(":");
			if (colon === -1) {
				this.logger.error(`Skipping invalid lcov record line: "${line}"`);
				continue;
			}

			const fieldType = line.substring(0, colon);
			const value = line.substring(colon + 1);

			// Format is documented at https://github.com/jandelgado/gcov2lcov?tab=readme-ov-file#tracefile-format-reference
			// however Dart doesn't strictly follow this. Execution counts are not accurate (only whether 0
			// or non-zero) and branch coverage (BRDA) is basically also just line counts.
			switch (fieldType) {
				case "TN": // TN:<test name>
					break;
				case "SF": // SF:<absolute (OR RELATIVE) path to the source file>
					sourceFilePath = value;
					break;
				case "DA": // DA:<line number>,<execution count>[,<checksum>]
					{
						const valueParts = value.split(",").map((p) => p.trim());
						const lineNumber = parseInt(valueParts[0], 10);
						const taken = parseInt(valueParts[1], 10);
						recordLine(lineNumber, taken);
					}
					break;
				case "BRDA": // BRDA:<line number>,<block number>,<branch number>,<taken>
					{
						const valueParts = value.split(",").map((p) => p.trim());
						const lineNumber = parseInt(valueParts[0], 10);
						const taken = parseInt(valueParts[3], 10);
						recordLine(lineNumber, taken);
					}
					break;
				case "LF": // LF:<number of instrumented lines>
					// We don't use LF/LH because they are not accurate due to how branches
					// are reported. Instead, we will count the values from lineHits at the end.
					// numberOfLinesFound = parseInt(value, 10);
					break;
				case "LH": // LH:<number of lines with a non-zero execution count>
					// We don't use LF/LH because they are not accurate due to how branches
					// are reported. Instead, we will count the values from lineHits at the end.
					// numberOfLinesHit = parseInt(value, 10);
					break;
			}
		}

		if (!sourceFilePath) {
			this.logger.error(`Skipping coverage record due to missing source file path`);
			return;
		}

		return new DartFileCoverageDetail(sourceFilePath, coverableLines, coveredLines);
	}
}

export class DartFileCoverageDetail {
	constructor(
		public readonly sourceFilePath: string,
		public readonly coverableLines: Set<number>,
		public readonly coveredLines: Set<number>,
	) { }
}
