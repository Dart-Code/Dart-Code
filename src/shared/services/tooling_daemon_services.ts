export interface DtdResult { type: string }
export interface DtdError {
	code: number,
	message: string,
	data: any,
}
export type DtdSuccess = DtdResult & { type: "Success" };
export type DtdResponse = { id: string } & ({ result: DtdResult } | { error: DtdError });

export interface DtdRequest {
	jsonrpc: "2.0",
	id: string;
	method: string;
	params: any;
}

export enum Service {
	setIDEWorkspaceRoots = "FileSystem.setIDEWorkspaceRoots",
	getIDEWorkspaceRoots = "FileSystem.getIDEWorkspaceRoots",
	readFileAsString = "FileSystem.readFileAsString",
}

export interface SetIDEWorkspaceRootsParams {
	secret: string;
	roots: string[];
}
export type SetIDEWorkspaceRootsResult = DtdSuccess;

export type GetIDEWorkspaceRootsParams = void;
export interface GetIDEWorkspaceRootsResult {
	type: "IDEWorkspaceRoots",
	ideWorkspaceRoots: string[];
}

export interface ReadFileAsStringParams {
	uri: string;
}
export interface ReadFileAsStringResult {
	type: "FileContent",
	content: string;
}
