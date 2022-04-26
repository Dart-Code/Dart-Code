import { strict as assert } from "assert";
import { Uri } from "vscode";
import { stripMarkdown } from "../../shared/utils/dartdocs";
import { cleanDartdoc, extensionPath } from "../../shared/vscode/extension_utils";

describe("cleanDartDoc", () => {
	it("replaces Flutter's image tags with Material image Markdown", () => {
		const input = `
<i class="material-icons md-36">360</i> &#x2014; material icon named "360".

<i class="material-icons-round md-36">class</i> &#x2014; material icon named "class round".

<i class="material-icons-sharp md-36">class</i> &#x2014; material icon named "class sharp".

<i class="material-icons md-36">try</i> &#x2014; material icon named "try".
		`;
		const expected = `
![threesixty](${Uri.file(extensionPath)}/media/doc-icons/material/threesixty%402x.png|width=32,height=32)

material icon named "360".

![class_rounded](${Uri.file(extensionPath)}/media/doc-icons/material/class_rounded%402x.png|width=32,height=32)

material icon named "class round".

![class_sharp](${Uri.file(extensionPath)}/media/doc-icons/material/class_sharp%402x.png|width=32,height=32)

material icon named "class sharp".

![try_sms_star](${Uri.file(extensionPath)}/media/doc-icons/material/try_sms_star%402x.png|width=32,height=32)

material icon named "try".
		`;
		assert.equal(cleanDartdoc(input), expected);
	});
	it("replaces Flutter's image tags with Cupertino image Markdown", () => {
		const input = `
<i class='cupertino-icons md-36'>plus_circle</i> &#x2014; Cupertino icon named "plus circle".

<i class='cupertino-icons md-36'>ant_circle_fill</i> &#x2014; Cupertino icon named "ant circle fill".

<i class='cupertino-icons md-36'>arrow_clockwise_circle</i> &#x2014; Cupertino icon named "arrow clockwise circle".

<i class='cupertino-icons md-36'>arrow_clockwise_circle_fill</i> &#x2014; Cupertino icon named "arrow clockwise circle fill".
		`;
		const expected = `
![plus_circle](${Uri.file(extensionPath)}/media/doc-icons/cupertino/plus_circle%402x.png|width=32,height=32)

Cupertino icon named "plus circle".

![ant_circle_fill](${Uri.file(extensionPath)}/media/doc-icons/cupertino/ant_circle_fill%402x.png|width=32,height=32)

Cupertino icon named "ant circle fill".

![arrow_clockwise_circle](${Uri.file(extensionPath)}/media/doc-icons/cupertino/arrow_clockwise_circle%402x.png|width=32,height=32)

Cupertino icon named "arrow clockwise circle".

![arrow_clockwise_circle_fill](${Uri.file(extensionPath)}/media/doc-icons/cupertino/arrow_clockwise_circle_fill%402x.png|width=32,height=32)

Cupertino icon named "arrow clockwise circle fill".
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
