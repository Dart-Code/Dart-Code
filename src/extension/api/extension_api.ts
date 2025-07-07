import * as vs from "vscode";
import { Sdks } from "../../shared/interfaces";
import { PublicDartExtensionApi, PublicSdks } from "./interfaces";

/// A single instance of this class is created (below) that is used internally to modify the data
/// provided by the API.
class DartExtensionApiData {
	public readonly version = 2;

	public sdks: Sdks | undefined;
	public dtdUri: string | undefined;

	private onSdksChangedEmitter = new vs.EventEmitter<Sdks>();
	public readonly onSdksChanged = this.onSdksChangedEmitter.event;

	private onDtdUriChangedEmitter = new vs.EventEmitter<string | undefined>();
	public readonly onDtdUriChanged = this.onDtdUriChangedEmitter.event;

	public setSdks(sdks: Sdks) {
		this.sdks = sdks;
		this.onSdksChangedEmitter.fire(sdks);
	}

	public setDtdUri(dtdUri: string | undefined) {
		this.dtdUri = dtdUri;
		this.onDtdUriChangedEmitter.fire(dtdUri);
	}
}

export const extensionApiData = new DartExtensionApiData();
const data = extensionApiData;

export class PublicDartExtensionApiImpl implements PublicDartExtensionApi {
	// Important: Don't use "this" in this class because we currently
	// spread this object into the value returned from activate().

	public get version() { return extensionApiData.version; };

	public get sdks(): PublicSdks {
		return data.sdks ? { ...data.sdks } : {};
	}

	public get onSdksChanged(): vs.Event<PublicSdks> {
		return (listener, thisArgs?, disposables?) =>
			data.onSdksChanged((sdks) => {
				const publicSdks: PublicSdks = sdks ? { ...sdks } : {};
				listener.call(thisArgs, publicSdks);
			}, thisArgs, disposables);
	}

	public get dtdUri(): string | undefined {
		return data.dtdUri;
	}

	public get onDtdUriChanged(): vs.Event<string | undefined> {
		return data.onDtdUriChanged;
	}
}

