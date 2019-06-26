import { IAmDisposable } from "../../shared/interfaces";

export class FakeStdIOService implements IAmDisposable {
	private readonly disposables: IAmDisposable[] = [];

	protected notify<T>(subscriptions: Array<(notification: T) => void>, notification: T) {
		subscriptions.slice().forEach((sub) => sub(notification));
	}

	protected subscribe<T>(subscriptions: Array<(notification: T) => void>, subscriber: (notification: T) => void): IAmDisposable {
		subscriptions.push(subscriber);
		const disposable = {
			dispose: () => {
				// Remove from the subscription list.
				let index = subscriptions.indexOf(subscriber);
				if (index >= 0) {
					subscriptions.splice(index, 1);
				}

				// Also remove from our disposables (else we'll leak it).
				index = this.disposables.indexOf(disposable);
				if (index >= 0) {
					this.disposables.splice(index, 1);
				}
			},
		};

		this.disposables.push(disposable);

		return disposable;
	}

	public dispose() {
		this.disposables.forEach((d) => d.dispose());
	}
}
