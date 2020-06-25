import * as assert from "assert";
import { FakeProcessStdIOService } from "../../services/fake_stdio_service";

describe("stdio_service", () => {

	let service: FakeProcessStdIOService<unknown>;
	beforeEach(() => service = new FakeProcessStdIOService<unknown>());

	const event1 = { event: "daemon.connected", params: { version: "0.5.3", pid: 4953 } };
	const event2 = { event: "daemon.connected2", params: { version: "0.5.3", pid: 4953 } };

	["\n", "\r\n", "\r"].forEach((terminator) => {
		function sendMessages(...messages: unknown[]) {
			sendRaw(...messages.map((m) => `${JSON.stringify(m)}${terminator}`));
		}

		function sendRaw(...messages: string[]) {
			const packet = messages.join("");
			service.sendStdOut(`${packet}`);
		}

		it(`handles simple JSON notifications terminated with ${JSON.stringify(terminator)}`, async () => {
			sendMessages(event1);

			assert.deepStrictEqual(service.notifications, [event1]);
		});

		it(`handles batches of multiple JSON notifications separated with ${JSON.stringify(terminator)}`, async () => {
			sendMessages(event1, event2);

			assert.deepStrictEqual(service.notifications, [event1, event2]);
		});

		it(`handles messages split across multiple packets terminated with ${JSON.stringify(terminator)}`, async () => {
			const eventJson = JSON.stringify(event1);
			sendRaw(eventJson.substring(0, 5));
			sendRaw(eventJson.substring(5));
			sendRaw(terminator);

			assert.deepStrictEqual(service.notifications, [event1]);
		});

		it(`processes unhandled messages terminated with ${JSON.stringify(terminator)}`, async () => {
			sendRaw(`this is a string${terminator}this is a string${terminator}`);

			assert.deepStrictEqual(service.unhandledMessages, [`this is a string\n`, `this is a string\n`]);
		});
	});
});
