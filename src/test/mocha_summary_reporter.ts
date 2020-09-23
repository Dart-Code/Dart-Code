import * as fs from "fs";
import { reporters, Test } from "mocha";

const isWin = process.platform.startsWith("win");
const isMac = process.platform === "darwin";
const osName = isWin ? "win" : isMac ? "osx" : "linux";

export class SummaryReporter extends reporters.Base {
	private passed = 0;
	private skipped = 0;
	private failed = 0;

	constructor(runner: any, private options: any) {
		super(runner);

		runner.on("pending", (test: Test) => {
			this.skipped++;
		});

		runner.on("pass", (test: Test) => {
			this.passed++;
		});

		runner.on("fail", (test: Test) => {
			this.failed++;
		});

		runner.once("end", () => {
			if (!this.options.reporterOptions.summaryFile)
				return;
			const name = this.options.reporterOptions.testRunName || "Unknown";
			fs.appendFileSync(this.options.reporterOptions.summaryFile,
				`${osName},${name},${this.passed},${this.skipped},${this.failed}\n`);
		});
	}
}
