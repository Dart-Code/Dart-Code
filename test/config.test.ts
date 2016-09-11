import * as assert from 'assert';
import * as config from '../src/config';

describe("config.vsCodeVersion", () => {
    it("should consider scrollable hovers for >= code 1.6", () => {
        assert.equal(new config.CodeCapabilities("1.5.0").hasScrollableHovers, false);
		assert.equal(new config.CodeCapabilities("1.5.1").hasScrollableHovers, false);
		assert.equal(new config.CodeCapabilities("1.5.9").hasScrollableHovers, false);
		assert.equal(new config.CodeCapabilities("1.6.0-dev").hasScrollableHovers, true);
		assert.equal(new config.CodeCapabilities("1.6.0").hasScrollableHovers, true);
		assert.equal(new config.CodeCapabilities("1.6.1").hasScrollableHovers, true);
		assert.equal(new config.CodeCapabilities("2.0.0").hasScrollableHovers, true);
    });
});
