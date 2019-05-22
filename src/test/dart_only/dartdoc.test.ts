import * as assert from "assert";
import { cleanDartdoc, stripMarkdown } from "../../extension/dartdocs";

describe("cleanDartDoc", () => {
	it("replaces Flutter's image tags with external Material image tags", () => {
		const input = `
		<i class="material-icons md-36">360</i> &#x2014; material icon named "360".
		<p><i class="material-icons md-36">360</i> &#x2014; material icon named "360".</p>
		`;
		const expected = `
		![360](https://raw.githubusercontent.com/Dart-Code/Icons/master/material/360%402x.png|width=32,height=32)
		![360](https://raw.githubusercontent.com/Dart-Code/Icons/master/material/360%402x.png|width=32,height=32)
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
	it("strips dartdoc directives from multiline strings", () => {
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
	it("strips dartdoc directives from single line strings", () => {
		const input = `{@macro flutter.widgets.widgetsApp.debugShowCheckedModeBanner}`;
		const expected = ``;
		assert.equal(cleanDartdoc(input), expected);
	});
	it("strips section names from code block headers", () => {
		const input = `
		Would you like to see some code?
		\`\`\`dart xxx
		class Foo extends StatelessWidget {
		}
		\`\`\`
		More?
		\`\`\`dart yyy
		class Foo extends StatelessWidget {
		}
		\`\`\`
		How about one without?
		\`\`\`dart
		class Foo extends StatelessWidget {
		}
		\`\`\`
		`;
		const expected = `
		Would you like to see some code?
		\`\`\`dart
		class Foo extends StatelessWidget {
		}
		\`\`\`
		More?
		\`\`\`dart
		class Foo extends StatelessWidget {
		}
		\`\`\`
		How about one without?
		\`\`\`dart
		class Foo extends StatelessWidget {
		}
		\`\`\`
		`;
		assert.equal(cleanDartdoc(input), expected);
	});
});

describe("stripMarkdown", () => {
	it("removes links and references", () => {
		const input = `
		This example shows a [Scaffold] with an [AppBar], a [BottomAppBar] and a
		[FloatingActionButton]. The [body] is a [Text] placed in a [Center] in order
		to center the text within the
		`;
		const expected = `
		This example shows a Scaffold with an AppBar, a BottomAppBar and a
		FloatingActionButton. The body is a Text placed in a Center in order
		to center the text within the
		`;
		assert.equal(stripMarkdown(input), expected);
	});
});
