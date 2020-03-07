import * as assert from "assert";
import { RingLog } from "../../../shared/logging";

describe("ring_log", () => {
	it("wraps around when reaching max size", () => {
		const log = new RingLog(10);
		for (let i = 1; i <= 25; i++) {
			log.log(`Line ${i}`);
		}
		assert.deepStrictEqual(log.rawLines,
			[
				"Line 21",
				"Line 22",
				"Line 23",
				"Line 24",
				"Line 25",
				"Line 16",
				"Line 17",
				"Line 18",
				"Line 19",
				"Line 20",
			],
		);
	});

	it("assembles lines in the correct order in toString()", () => {
		const log = new RingLog(10);
		for (let i = 1; i <= 25; i++) {
			log.log(`Line ${i}`);
		}
		assert.equal(log.toString(),
			`Line 16
Line 17
Line 18
Line 19
Line 20
Line 21
Line 22
Line 23
Line 24
Line 25`,
		);
	});
});
