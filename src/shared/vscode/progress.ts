import * as vs from "vscode";
import { oneSecondInMs } from "../constants";

/**
 * Waits for a promise to complete, showing a progress notification with the supplied text if it
 * takes longer than a specified time.
 */
export function withProgressIfSlow<T>(
	action: Promise<T>,
	cancellationTokenSource: vs.CancellationTokenSource,
	progressText: string,
	{ showAfterMs }: { showAfterMs?: number } = { showAfterMs: oneSecondInMs },
): Promise<T> {
	// Show progress until the action completes, but only start after the specified time.
	const progressTimer = setTimeout(() => {
		vs.window.withProgress(
			{
				title: progressText,
				location: vs.ProgressLocation.Notification,
				cancellable: true,
			}, (_progress, token) => {
				token.onCancellationRequested(() => cancellationTokenSource.cancel());
				return action;
			},
		);
	}, showAfterMs);

	// Don't keep anything alive.
	progressTimer.unref();

	// If the action completes before the timer fires, cancel it.
	return action.finally(() => progressTimer.close());
}
