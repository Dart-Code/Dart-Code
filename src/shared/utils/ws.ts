import * as ws from "ws";

/**
 * Start a frequent (15s) ping over the websocket until it closes.
 *
 * This avoids issues where proxies (such as the Norton 360 antivirus) might
 * drop connections if there is no traffic for 60s.
 *
 * https://github.com/Dart-Code/Dart-Code/issues/5794
 */
export function attachPing(socket: ws.WebSocket, pingInterval = 15000) {
	const startPinging = () => {
		const timer = setInterval(() => {
			if (socket.readyState === ws.WebSocket.OPEN) {
				try {
					socket.ping();
				} catch {
					clear();
				}
			} else {
				clear();
			}
		}, pingInterval);

		const clear = () => {
			clearInterval(timer);
			socket.removeListener("close", clear);
			socket.removeListener("error", clear);
		};

		socket.on("close", clear);
		socket.on("error", clear);
	};

	if (socket.readyState === ws.WebSocket.OPEN) {
		startPinging();
	} else {
		socket.once("open", startPinging);
	}
}
