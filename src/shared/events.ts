import * as evt from "events";
import { IAmDisposable } from "./interfaces";

export class EventEmitter<T> implements IAmDisposable {
	private emitter = new evt.EventEmitter();

	public fire(x: T): void {
		this.emitter.emit("thing", x);
	}

	public listen(listener: (e: T) => any, thisArgs?: any): IAmDisposable {
		if (thisArgs)
			listener = listener.bind(thisArgs);
		this.emitter.on("thing", listener);
		return {
			dispose: () => { this.emitter.removeListener("thing", listener); },
		};
	}

	public get event(): Event<T> { return this.listen.bind(this); }

	public dispose() {
		this.emitter.removeAllListeners();
	}
}

export class EventsEmitter<T> implements IAmDisposable {
	private emitter = new evt.EventEmitter();

	public fire(event: string, x: T): void {
		this.emitter.emit(event, x);
	}

	public listen(event: string, listener: (e: T) => any, thisArgs?: any): IAmDisposable {
		if (thisArgs)
			listener = listener.bind(thisArgs);
		this.emitter.on(event, listener);
		return {
			dispose: () => { this.emitter.removeListener(event, listener); },
		};
	}

	public dispose() {
		this.emitter.removeAllListeners();
	}
}

export type Event<T> = (listener: (e: T) => any, thisArgs?: any) => IAmDisposable;
