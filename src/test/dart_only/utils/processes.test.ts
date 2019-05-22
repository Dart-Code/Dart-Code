import * as assert from "assert";
import { toolEnv } from "../../../extension/utils/processes";
import { setConfigForTest } from "../../helpers";

describe("process utils", () => {
	it("toolEnv includes PUB_ENVIRONMENT", () => {
		assert.ok(toolEnv.PUB_ENVIRONMENT);
	});
	it("toolEnv includes dart.env from config", async () => {
		await setConfigForTest("dart", "env", { FLUTTER_FOO_EMBEDDING: true });
		assert.equal(toolEnv.FLUTTER_FOO_EMBEDDING, true);
	});
});
