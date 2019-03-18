import * as https from "https";
import { config } from "../config";

export interface FlutterSampleSnippet {
	readonly sourcePath: string;
	readonly sourceLine: number;
	readonly package: string;
	readonly library: string;
	readonly element: string;
	readonly id: string;
	readonly file: string;
	readonly description: string;
}

export function getFlutterSnippets(): Promise<FlutterSampleSnippet[]> {
	return new Promise<FlutterSampleSnippet[]>((resolve, reject) => {
		if (!config.flutterDocsHost)
			reject("No Flutter docs host set");
		const options: https.RequestOptions = {
			hostname: config.flutterDocsHost,
			method: "GET",
			path: "/snippets/index.json",
			port: 443,
		};

		const req = https.request(options, (resp) => {
			if (!resp || !resp.statusCode || resp.statusCode < 200 || resp.statusCode > 300) {
				// TODO: Remove this check after the live docs host has the index file.
				if (resp.statusCode === 404)
					resolve(temporaryFlutterSnipetsIndexFor1dot0);
				else
					reject({ message: `Failed to get Flutter samples ${resp && resp.statusCode}: ${resp && resp.statusMessage}` });
			} else {
				const chunks: string[] = [];
				resp.on("data", (b) => chunks.push(b.toString()));
				resp.on("end", () => {
					const json = chunks.join("");
					resolve(JSON.parse(json));
				});
			}
		});
		req.end();
	});
}

export const temporaryFlutterSnipetsIndexFor1dot0 = [
	/* tslint:disable */
	{
		"sourcePath": "lib/src/material/icon_button.dart",
		"sourceLine": 103,
		"package": "flutter",
		"library": "material",
		"element": "IconButton",
		"id": "material.IconButton",
		"file": "material.IconButton.dart",
		"description": "In this sample the icon button's background color is defined with an [Ink]\nwidget whose child is an [IconButton]. The icon button's filled background\nis a light shade of blue, it's a filled circle, and it's as big as the\nbutton is."
	},
	{
		"sourcePath": "lib/src/material/card.dart",
		"sourceLine": 65,
		"package": "flutter",
		"library": "material",
		"element": "Card",
		"id": "material.Card",
		"file": "material.Card.dart",
		"description": "This sample shows creation of a [Card] widget that shows album information\nand two actions."
	},
	{
		"sourcePath": "lib/src/material/chip.dart",
		"sourceLine": 206,
		"package": "flutter",
		"library": "material",
		"element": "DeletableChipAttributes.onDeleted",
		"id": "material.DeletableChipAttributes.onDeleted",
		"file": "material.DeletableChipAttributes.onDeleted.dart",
		"description": "This sample shows how to use [onDeleted] to remove an entry when the\ndelete button is tapped."
	},
	{
		"sourcePath": "lib/src/material/app_bar.dart",
		"sourceLine": 246,
		"package": "flutter",
		"library": "material",
		"element": "AppBar.actions",
		"id": "material.AppBar.actions",
		"file": "material.AppBar.actions.dart",
		"description": "This sample shows adding an action to an [AppBar] that opens a shopping cart."
	},
	{
		"sourcePath": "lib/src/material/scaffold.dart",
		"sourceLine": 781,
		"package": "flutter",
		"library": "material",
		"element": "Scaffold",
		"id": "material.Scaffold",
		"file": "material.Scaffold.dart",
		"description": "This example shows a [Scaffold] with an [AppBar], a [BottomAppBar] and a\n[FloatingActionButton]. The [body] is a [Text] placed in a [Center] in order\nto center the text within the [Scaffold] and the [FloatingActionButton] is\ncentered and docked within the [BottomAppBar] using\n[FloatingActionButtonLocation.centerDocked]. The [FloatingActionButton] is\nconnected to a callback that increments a counter."
	}
	/* tslint:enable */
];
