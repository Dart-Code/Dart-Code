import { EventEmitter } from "./events";
import { IAmDisposable, Sdks, WorkspaceConfig } from "./interfaces";

export class WorkspaceContext implements IAmDisposable {
	public readonly workspaceTypeDescription: string;
	public readonly events = new WorkspaceEvents();
	// TODO: Move things from Sdks to this class that aren't related to the SDKs.
	constructor(
		public readonly sdks: Sdks,
		public readonly config: WorkspaceConfig,
		public readonly hasAnyFlutterProjects: boolean,
		public readonly hasAnyWebProjects: boolean,
		public readonly hasAnyStandardDartProjects: boolean,
		public readonly hasProjectsInFuchsiaTree: boolean,
	) {
		this.workspaceTypeDescription = this.buildWorkspaceTypeDescription();
	}

	get shouldLoadFlutterExtension() { return this.hasAnyFlutterProjects; }

	/// Used only for display (for ex stats), not behaviour.
	private buildWorkspaceTypeDescription(): string {
		const types: string[] = [];
		// Don't re-order these, else stats won't easily combine as we could have
		// Dart, Flutter and also Flutter, Dart.
		if (this.hasAnyStandardDartProjects)
			types.push("Dart");
		if (this.hasAnyFlutterProjects)
			types.push("Flutter");
		if (this.hasProjectsInFuchsiaTree)
			types.push("Fuchsia");

		// If we didn't detect any projects, record as unknown, but include info
		// on the type of SDK we had found.
		if (types.length === 0) {
			if (this.sdks && this.sdks.dartSdkIsFromFlutter)
				types.push("Unknown (Flutter SDK)");
			else if (this.sdks && this.sdks.dart)
				types.push("Unknown (Dart SDK)");
			else
				types.push("Unknown (No SDK)");
		}

		return types.join(", ");
	}

	public dispose(): any {
		this.events.dispose();
	}

	// TODO: Since this class is passed around, we may need to make it update itself
	// (eg. if the last Flutter project is removed from the multi-root workspace)?
}

class WorkspaceEvents implements IAmDisposable {
	public readonly onPackageMapChange = new EventEmitter<void>();

	public dispose(): any {
		this.onPackageMapChange.dispose();
	}
}
