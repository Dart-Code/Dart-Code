export interface DtdResult { type: string }
export interface DtdError {
	error: {
		code: number,
		message: string,
		data: any,
	};
}
export type DtdSuccess = DtdResult & { type: "Success" };
export type DtdResponse = { id: string } & (DtdResult | DtdError);

export interface DtdRequest {
	jsonrpc: "2.0",
	id: string;
	method: string;
	params: any;
}

export enum Service {
	setIDEWorkspaceRoots = "FileSystem.setIDEWorkspaceRoots",
}

export interface SetIDEWorkspaceRootsParams {
	secret: string;
	roots: string[];
}

export type SetIDEWorkspaceRootsResult = DtdSuccess;
