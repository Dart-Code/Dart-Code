
export interface Request<T> {
	id: string;
	method: string;
	params: T;
}

interface Response<T> {
	id: string;
	error: any;
	result: T;
}

export type UnknownResponse = Response<any>;

interface Notification<T> {
	event: string;
	params: T;
}

export type UnknownNotification = Notification<any>;
