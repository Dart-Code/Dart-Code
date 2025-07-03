
export interface Request<T> {
	id: string;
	method: string;
	params: T;
}

export interface Response<T> {
	id: string;
	error: any;
	result: T;
}

export type UnknownResponse = Response<any>;

export interface Notification<T> {
	event: string;
	params: T;
}

export type UnknownNotification = Notification<any>;
