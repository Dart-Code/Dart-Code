import * as http from "http";
import * as ws from "ws";
import { attachPing } from "../../../shared/utils/ws";

describe("attachPing", () => {
	let server: http.Server;
	let wss: ws.Server;

	beforeEach(() => {
		server = http.createServer();
		wss = new ws.Server({ server });
		server.listen();
	});

	afterEach(() => {
		wss.close();
		server.close();
	});

	it("sends pings", async () => {
		const serverReceivedPingPromise = new Promise((resolve) => wss.once("connection", (c) => c.once("ping", resolve)));

		const port = (server.address() as any).port;
		const socket = new ws.WebSocket(`ws://localhost:${port}`);
		attachPing(socket, 10); // 10ms interval to avoid test taking long.

		// Wait for the server to get a ping.
		await serverReceivedPingPromise;

		socket.close();
	});
});
