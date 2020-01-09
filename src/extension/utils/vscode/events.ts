import { Disposable, Event } from "vscode";

/**
 * Listens for two events and returns a promise resolving when the first event completes.
 *
 * @param a the first event to subscribe to
 * @param b the second event to subscribe to
 */
export function firstOf<T1, T2>(a: Event<T1>, b: Event<T2>): Promise<T1 | T2> {
	return new Promise((resolve) => {
		let completed = false;
		const disposables = Array<Disposable>();

		function complete(value: T1 | T2) {
			if (completed) return;
			completed = true;

			disposables.forEach((d) => d.dispose());
			resolve(value);
		}

		a(complete, disposables);
		b(complete, disposables);
	});
}
