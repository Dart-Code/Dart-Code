import { strict as assert } from "assert";
import { LogCategory } from "../../../shared/enums";
import { EmittingLogger, RingLog } from "../../../shared/logging";
import { defer, sb } from "../../helpers";

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

	it("formats LogMessage entries lazily with original timestamp and truncation", () => {
		const logger = new EmittingLogger();
		const ringLog = new RingLog(10);
		const sub = logger.onLog((message) => ringLog.log(message, 10));
		defer("dispose log listener", () => sub.dispose());

		const toLocaleTimeStringSpy = sb.spy(Date.prototype, "toLocaleTimeString");
		const clock = sb.useFakeTimers({ now: new Date(2026, 0, 1, 12, 34, 56).getTime() });
		const expectedTimestamp = new Date(2026, 0, 1, 12, 34, 56).toLocaleTimeString();
		toLocaleTimeStringSpy.resetHistory();

		logger.info("0123456789abcdef", LogCategory.Analyzer);
		logger.warn("warn msg", LogCategory.General);
		assert.equal(toLocaleTimeStringSpy.callCount, 0);

		clock.tick(60_000);
		const output = ringLog.toString();
		assert.equal(toLocaleTimeStringSpy.callCount, 2);

		const lines = output.split("\n");
		assert.equal(lines.length, 2);
		assert.equal(lines[0], `[${expectedTimestamp}] [Analyzer] [Info] 0123456789…`);
		assert.ok(lines[1].startsWith(`[${expectedTimestamp}] [General] [Warn] warn msg`));
	});
});
