interface Notification {
	type: string;
	time: number;
}

interface StartNotification extends Notification {
	protocolVersion: string;
	runnerVersion?: string;
}
interface AllSuitesNotification extends Notification {
	count: number;
}

interface SuiteNotification extends Notification {
	suite: Suite;
}

interface Suite {
	id: number;
	platform: string;
	path: string;
}

interface TestNotification extends Notification {
	test: Test;
}

interface Item {
	id: number;
	name?: string;
	suiteID: number;
	metadata: Metadata;
	line?: number;
	column?: number;
	url?: string;
}

interface Test extends Item {
	groupIDs: Group[];
}

interface Metadata {
	skip: boolean;
	skipReason?: string;
}

interface TestDoneNotification extends Notification {
	testID: number;
	result: string;
	skipped: boolean;
	hidden: boolean;
}

interface GroupNotification extends Notification {
	group: Group;
}

interface Group extends Item {
	parentID?: number;
	testCount: number;
}

interface TestStartNotification extends Notification {
	test: Test;
}

interface TestDoneNotification extends Notification {
	testID: number;
	result: string;
	skipped: boolean;
	hidden: boolean;
}

interface DoneNotification extends Notification {
	success: boolean;
}
