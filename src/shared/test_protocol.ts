export interface Notification {
	type: string;
	time: number;
}

export interface SuiteNotification extends Notification {
	suite: Suite;
}

interface Suite {
	id: number;
	platform: string;
	path: string;
}

interface Item {
	id: number;
	name?: string;
	suiteID: number;
	line: number | undefined | null;
	column: number | undefined | null;
	url: string | undefined | null;
	root_line: number | undefined | null;
	root_column: number | undefined | null;
	root_url: string | undefined | null;
}

export interface Test extends Item {
	groupIDs: number[];
}

export interface GroupNotification extends Notification {
	group: Group;
}

interface Group extends Item {
	parentID?: number;
	testCount: number;
}

export interface TestStartNotification extends Notification {
	test: Test;
}

export interface TestDoneNotification extends Notification {
	testID: number;
	result: "success" | "failure" | "error";
	skipped: boolean;
	hidden: boolean;
}


export interface PrintNotification extends Notification {
	testID: number;
	messageType: string;
	message: string;
}

export interface ErrorNotification extends Notification {
	testID: number;
	error: string;
	stackTrace: string;
	isFailure: boolean;
}
