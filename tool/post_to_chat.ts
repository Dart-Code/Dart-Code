// This script is called by Travis/AppVeyor and posts the build status to a
// Hangouts Chat room. It requires an endpoint which is set in a secure variable
// (and thus will not run for PRs).

import * as https from "https";

const chatWebHookPath = process.env.CHAT_WEBHOOK_PATH;

function sendToChat(message: string): Promise<void> {
	if (!chatWebHookPath) {
		return;
	}
	console.log("Posting results to chat...");
	return new Promise((resolve, reject) => {
		const options: https.RequestOptions = {
			headers: {
				"Content-Type": "application/json; charset=UTF-8",
			},
			hostname: "chat.googleapis.com",
			method: "POST",
			path: chatWebHookPath,
			port: 443,
		};
		const req = https.request(options, (resp) => {
			// resp.on("data", (c) => console.log(c.toString()));
			resp.on("error", (c) => console.error(c.toString()));

			if (resp.statusCode < 200 || resp.statusCode > 300) {
				console.log(`Failed to send chat message ${resp.statusCode}: ${resp.statusMessage}`);
			}
			resolve();
		});
		req.write(JSON.stringify({
			text: message,
		}));
		req.end();
	});
}

async function send_summary_message() {
	const pEnv = process.env;
	if (pEnv.CI) {
		const hasFailed = pEnv.TRAVIS_TEST_RESULT === "1" || pEnv.APPVEYOR_RESULT;

		let buildUrl: string;
		if (process.env.TRAVIS) {
			buildUrl = `https://travis-ci.org/${pEnv.TRAVIS_REPO_SLUG}/builds/${pEnv.TRAVIS_BUILD_ID}`;
		} else if (process.env.APPVEYOR) {
			buildUrl = `https://ci.appveyor.com/project/${pEnv.APPVEYOR_ACCOUNT_NAME}/${pEnv.APPVEYOR_PROJECT_SLUG}/build/${pEnv.APPVEYOR_BUILD_VERSION}`;
		}
		const commitAuthor = pEnv.APPVEYOR_REPO_COMMIT_AUTHOR || pEnv.TRAVIS_COMMIT_AUTHOR;
		const commitMessage = pEnv.APPVEYOR_REPO_COMMIT_MESSAGE || pEnv.TRAVIS_COMMIT_MESSAGE;
		const branchName = pEnv.APPVEYOR_REPO_BRANCH || pEnv.TRAVIS_BRANCH;
		const flavor = pEnv.TRAVIS_OS_NAME || "";
		const buildName = `${flavor} BUILD`.trim().toUpperCase();

		const message =
			`*${buildName} ${hasFailed ? "FAILURE <users/all>" : "SUCCESS"}*\n\n`
			+ `*${commitAuthor}* _${branchName}_\n`
			+ `${commitMessage}\n\n`
			+ `<${buildUrl}|Build Report>`;

		await sendToChat(message);
	}
}

send_summary_message();
