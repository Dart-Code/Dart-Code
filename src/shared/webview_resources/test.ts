/// <reference lib="dom" />

const info = document.querySelector("#info")!;

const icons = [
	{ startLine: 10, endLine: 20, preview: "https://raw.githubusercontent.com/Dart-Code/Icons/master/material/ac_unit%402x.png" },
	{ startLine: 30, endLine: 40, preview: "https://raw.githubusercontent.com/Dart-Code/Icons/master/material/access_alarm%402x.png" },
	{ startLine: 50, endLine: 70, preview: "https://raw.githubusercontent.com/Dart-Code/Icons/master/material/accessible%402x.png" },
];

const currentIcons: Element[] = [];
let lineHeight = 16;

window.addEventListener("message", (event) => {
	if (event && event.data.command === "updatePreviews") {
		const args: { firstVisibleLine: number, lastVisibleLine: number, firstSelectedLine: number, totalLines: number } = event.data.args;

		// Remove all old icons.
		currentIcons.forEach((icon) => icon.remove());
		currentIcons.length = 0;

		// Find any icons on-screen.
		// const visibleIcons = icons.filter((icon) => icon.endLine >= args.firstVisibleLine && icon.startLine <= args.lastVisibleLine);

		// info.textContent = `
		// 	${args.firstVisibleLine} - ${args.lastVisibleLine} of ${args.totalLines}
		// 	body client height: ${document.body.clientHeight}
		// 	body offset height: ${document.body.offsetHeight}
		// 	body scroll height: ${document.body.scrollHeight}
		// 	doc element client height: ${document.documentElement.clientHeight}
		// 	doc element offset height: ${document.documentElement.offsetHeight}
		// 	doc element scroll height: ${document.documentElement.scrollHeight}
		// 	window inner height: ${window.innerHeight}
		// 	line height: ${lineHeight}
		// 	doc height: ${args.totalLines * lineHeight}
		// 	scroll top: ${args.firstVisibleLine * lineHeight}
		// `;

		for (const icon of icons) {
			const offset = icon.startLine * lineHeight;
			const elm = document.createElement("img");
			elm.src = icon.preview;
			elm.style.position = "absolute";
			elm.style.top = `${offset}px`;
			elm.style.right = `10px`;
			elm.style.height = `100px`;

			document.body.appendChild(elm);
			currentIcons.push(elm);
		}
	}
	if (event && event.data.command === "updateScrollPosition") {
		const args: { firstVisibleLine: number, lastVisibleLine: number, firstSelectedLine: number, totalLines: number } = event.data.args;
		const newLineHeight = document.documentElement.clientHeight / (args.lastVisibleLine - args.firstVisibleLine);
		if (isFinite(newLineHeight))
			lineHeight = newLineHeight;
		document.documentElement.style.height = `${args.totalLines * lineHeight}px`;
		document.documentElement.scrollTo({ top: args.firstVisibleLine * lineHeight, behavior: "auto" });
	}
});
