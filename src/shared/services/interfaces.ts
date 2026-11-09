
export interface Request<T> {
	id: string;
	method: string;
	params: T;
}

interface Response<T> {
	id: string;
	error: unknown;
	result: T;
}

export type UnknownResponse = Response<unknown>;

interface Notification<T> {
	event: string;
	params: T;
}

export type UnknownNotification = Notification<unknown>;
