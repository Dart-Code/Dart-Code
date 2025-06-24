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
		let linesFound = 0;
		let linesHit = 0;
		const lineHits = new Map<number, number>();

		for (const line of record.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"))) {
			const fields = line.split(":");
			if (fields.length !== 2) {
				this.logger.error(`Skipping invalid lcov record line: "${line}"`);
				continue;
			}

			const fieldType = fields[0];
			const value = fields[1];

			switch (fieldType) {
				case "TN": // TN:<test name>
					break;
				case "SF": // SF:<absolute (OR RELATIVE) path to the source file>
					sourceFilePath = value;
					break;
				case "DA": // DA:<line number>,<execution count>[,<checksum>]
					const valueParts = value.split(",").map((p) => p.trim());
					const lineNumber = parseInt(valueParts[0], 10);
					const lineExecutionCount = parseInt(valueParts[1], 10);
					lineHits.set(lineNumber, lineExecutionCount);
					break;
				case "LF": // LF:<number of instrumented lines>
					linesFound = parseInt(value, 10);
					break;
				case "LH": // LH:<number of lines with a non-zero execution count>
					linesHit = parseInt(value, 10);
					break;

			}
		}

		if (!sourceFilePath) {
			this.logger.error(`Skipping coverage record due to missing source file path`);
			return;
		}

		return new DartFileCoverageDetail(sourceFilePath, linesFound, linesHit, lineHits);
	}
}

export class DartFileCoverageDetail {
	constructor(
		public readonly sourceFilePath: string,
		public readonly linesFound: number,
		public readonly linesHit: number,
		public readonly lineHits: Map<number, number>,
	) { }
}
