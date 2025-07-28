import * as vs from "vscode";
import { Sdks } from "../../shared/interfaces";
import { PublicDartExtensionApi } from "./interfaces";

/// A single instance of this class is created (below) that is used internally to modify the data
/// provided by the API.
class DartExtensionApiModel {
	public readonly version = 2;

	private onSdksChangedEmitter = new vs.EventEmitter<Sdks | undefined>();
	public readonly onSdksChanged = this.onSdksChangedEmitter.event;

	private onDtdUriChangedEmitter = new vs.EventEmitter<string | undefined>();
	public readonly onDtdUriChanged = this.onDtdUriChangedEmitter.event;
}

/// Use a single global static to store data exposed by the extension so that we don't
/// need to worry about different API objects being created during the lifetime of the
/// extension (for example during internal restarts).
export const extensionApiModel = new DartExtensionApiModel();
const data = extensionApiModel;

export class PublicDartExtensionApiImpl implements PublicDartExtensionApi {
	// All data returned from this class should be immutable/copies so that
	// callers cannot modify the values read by other extensions.

	public get version() { return extensionApiModel.version; };
}
