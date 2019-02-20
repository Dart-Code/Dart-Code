import * as assert from "assert";
import { toolEnv } from "../../../src/utils/processes";

describe("process utils", () => {
	it("toolEnv includes FLUTTER_HOST", () => {
		assert.ok(toolEnv.FLUTTER_HOST);
	});
});
