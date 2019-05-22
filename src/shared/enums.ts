
export enum TestStatus {
	// This should be in order such that the highest number is the one to show
	// when aggregating (eg. from children).
	Waiting,
	Passed,
	Skipped,
	Unknown,
	Failed,
	Errored,
	Running,
}
