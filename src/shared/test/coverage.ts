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
		const linesWithDirectCoverage = new Set<number>(); // Track lines that have DA entries
		const branchEntries: Array<{ lineNumber: number, taken: number }> = []; // Store BRDA entries for second pass

		function recordLine(lineNumber: number, taken: number) {
			coverableLines.add(lineNumber);
			if (taken > 0) {
				coveredLines.add(lineNumber);
			}
		}

		// First pass: collect all lines and identify which have direct coverage (DA) entries
		for (const line of record.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"))) {
			const fields = line.split(":");
			if (fields.length !== 2) {
				this.logger.error(`Skipping invalid lcov record line: "${line}"`);
				continue;
			}

			const fieldType = fields[0];
			const value = fields[1];

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
						linesWithDirectCoverage.add(lineNumber);
						recordLine(lineNumber, taken);
					}
					break;
				case "BRDA": // BRDA:<line number>,<block number>,<branch number>,<taken>
					{
						const valueParts = value.split(",").map((p) => p.trim());
						const lineNumber = parseInt(valueParts[0], 10);
						const taken = parseInt(valueParts[3], 10);
						branchEntries.push({ lineNumber, taken });
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

		// Second pass: process BRDA entries, filtering out spurious ones
		// Only include BRDA entries if:
		// 1. The branch was taken (taken > 0), OR
		// 2. There's a corresponding DA entry for that line
		// This filters out false positives from the Dart VM for structural lines like "} finally {"
		for (const branch of branchEntries) {
			if (branch.taken > 0 || linesWithDirectCoverage.has(branch.lineNumber)) {
				recordLine(branch.lineNumber, branch.taken);
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
