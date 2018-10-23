import * as assert from "assert";
import { cleanDartdoc } from "../../src/dartdocs";

describe("cleanDartDoc", () => {
	it("replaces Flutter's image tags with external Material image tags", () => {
		const input = `
		<i class="material-icons md-36">360</i> &#x2014; material icon named "360".
		<p><i class="material-icons md-36">360</i> &#x2014; material icon named "360".</p>
		`;
		const expected = `
		![360](https://storage.googleapis.com/material-icons/external-assets/v4/icons/svg/ic_360_white_36px.svg|width=100,height=100)
		![360](https://storage.googleapis.com/material-icons/external-assets/v4/icons/svg/ic_360_white_36px.svg|width=100,height=100)
		`;
		assert.equal(cleanDartdoc(input), expected);
	});
	it("removes ## Other resources section", () => {
		const input = `
		Some stuff
		## Other resources
		- Other resource
		`;
		const expected = `
		Some stuff
		`;
		assert.equal(cleanDartdoc(input), expected);
	});
	it("changes [code] to `code`", () => {
		const input = `
		See the [Widget] section.
		`;
		const expected = `
		See the \`Widget\` section.
		`;
		assert.equal(cleanDartdoc(input), expected);
	});
	it("strips dartdoc directives", () => {
		const input = `
		{@template flutter.widgets.widgetsApp.navigatorKey}
		A key to use when building the Navigator.
		{@endTemplate}
		{@template flutter.widgets.widgetsApp.navigatorKey}
		A key to use when building the Navigator.
		{@endTemplate}
		`;
		const expected = `
		A key to use when building the Navigator.
		A key to use when building the Navigator.
		`;
		assert.equal(cleanDartdoc(input), expected);
	});
});

/// {@template flutter.widgets.widgetsApp.navigatorKey}
/// A key to use when building the [Navigator].
///
/// If a [navigatorKey] is specified, the [Navigator] can be directly
/// manipulated without first obtaining it from a [BuildContext] via
/// [Navigator.of]: from the [navigatorKey], use the [GlobalKey.currentState]
/// getter.
///
/// If this is changed, a new [Navigator] will be created, losing all the
/// application state in the process; in that case, the [navigatorObservers]
/// must also be changed, since the previous observers will be attached to the
/// previous navigator.
///
/// The [Navigator] is only built if [onGenerateRoute] is not null; if it is
/// null, [navigatorKey] must also be null.
/// {@endTemplate}
