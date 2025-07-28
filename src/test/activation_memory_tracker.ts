// Detailed Extension Activation Memory Tracker
// This will help pinpoint exactly where in the activation process the 16GB leak occurs

import * as vs from "vscode";

export async function trackActivationMemory() {
	function logDetailedMemory(step: string) {
		const mem = process.memoryUsage();
		console.log(`[ACTIVATION-MEMORY] ${step}:`);
		console.log(`  RSS: ${(mem.rss / 1024 / 1024).toFixed(1)}MB`);
		console.log(`  Heap Used: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`);
		console.log(`  Heap Total: ${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB`);
		console.log(`  External: ${(mem.external / 1024 / 1024).toFixed(1)}MB`);
		console.log(`  Array Buffers: ${(mem.arrayBuffers / 1024 / 1024).toFixed(1)}MB`);
		return mem;
	}

	// Hook into VS Code extension activation
	const originalGetExtension = vs.extensions.getExtension;
	vs.extensions.getExtension = function <T = any>(extensionId: string): vs.Extension<T> | undefined {
		if (extensionId === "Dart-Code.dart-code") {
			logDetailedMemory(`Before getting Dart-Code extension`);
		}
		return originalGetExtension.call(this, extensionId) as vs.Extension<T> | undefined;
	};

	// Track specific activation phases
	let activationStep = 0;
	const steps = [
		"Extension activation start",
		"After getting extension",
		"Before ext.activate()",
		"After ext.activate()",
		"After getting exports",
		"After setup logging"
	];

	return {
		logStep: (customStep?: string) => {
			const step = customStep || steps[activationStep++] || `Step ${activationStep++}`;
			return logDetailedMemory(step);
		},
		logDetailedMemory
	};
}
