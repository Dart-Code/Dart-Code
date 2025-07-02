export interface Notification {
	type: string;
	time: number;
}

export interface StartNotification extends Notification {
	protocolVersion: string;
	runnerVersion?: string;
}

export interface AllSuitesNotification extends Notification {
	count: number;
}

export interface SuiteNotification extends Notification {
	suite: Suite;
}

export interface Suite {
	id: number;
	platform: string;
	path: string;
}

export interface TestNotification extends Notification {
	test: Test;
}

export interface Item {
	id: number;
	name?: string;
	suiteID: number;
	line?: number;
	column?: number;
	url?: string;
	root_line?: number;
	root_column?: number;
	root_url?: string;
}

export interface Test extends Item {
	groupIDs: number[];
}

export interface GroupNotification extends Notification {
	group: Group;
}

export interface Group extends Item {
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

export interface DoneNotification extends Notification {
	success: boolean;
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
