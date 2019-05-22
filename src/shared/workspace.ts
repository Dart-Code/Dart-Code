import { Sdks } from "./interfaces";

export class WorkspaceContext {
	// TODO: Move things from Sdks to this class that aren't related to the SDKs.
	constructor(
		public readonly sdks: Sdks,
		public readonly hasAnyFlutterMobileProjects: boolean,
		public readonly hasAnyFlutterWebProjects: boolean,
		public readonly hasAnyStandardDartProjects: boolean,
		public readonly hasProjectsInFuchsiaTree: boolean,
	) { }

	get hasOnlyDartProjects() { return !this.hasAnyFlutterProjects && !this.hasProjectsInFuchsiaTree; }
	get hasAnyFlutterProjects() { return this.hasAnyFlutterMobileProjects || this.hasAnyFlutterWebProjects; }
	get shouldLoadFlutterExtension() { return this.hasAnyFlutterProjects; }

	/// Used only for display (for ex stats), not behaviour.
	get workspaceTypeDescription(): string {
		const types: string[] = [];
		// Don't re-order these, else stats won't easily combine as we could have
		// Dart, Flutter and also Flutter, Dart.
		if (this.hasAnyStandardDartProjects)
			types.push("Dart");
		if (this.hasAnyFlutterMobileProjects)
			types.push("Flutter");
		if (this.hasAnyFlutterWebProjects)
			types.push("Flutter Web");
		if (this.hasProjectsInFuchsiaTree)
			types.push("Fuchsia");
		if (types.length === 0)
			types.push("Unknown");

		return types.join(", ");
	}

	// TODO: Since this class is passed around, we may need to make it update itself
	// (eg. if the last Flutter project is removed from the multi-root workspace)?
}
