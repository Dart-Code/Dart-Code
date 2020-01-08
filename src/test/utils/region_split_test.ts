import { MappedRegion, removeOverlappings } from "../../shared/utils/region_split";
import assert = require("assert");

describe("removeOverlappings", () => {
	it("splits nested tokens", () => {
		const input: MappedRegion[] = [
			new MappedRegion(0, 5, 0), // 00000
			new MappedRegion(2, 2, 1), // --11-
		];
		// should be flattened to 00110
		assert.equal(removeOverlappings(input), [
			new MappedRegion(0, 2, 0), // 00---
			new MappedRegion(2, 2, 1), // --11-
			new MappedRegion(4, 1, 0), // ----0
		]);
	});

	it("doesn't change anything when regions don't overlap", () => {
		const input: MappedRegion[] = [
			new MappedRegion(0, 5, 0),
			new MappedRegion(5, 2, 1),
			new MappedRegion(7, 3, 2),
			new MappedRegion(10, 5, 3),
		];
		assert.equal(removeOverlappings(input), input);
	});
});
