import * as assert from "assert";
import { toolEnv } from "../../../extension/utils/processes";

describe("process utils", () => {
	it("toolEnv includes FLUTTER_HOST", () => {
		assert.ok(toolEnv.FLUTTER_HOST);
	});
});
