import { LogCategory } from "./enums";
import { Logger } from "./interfaces";

export interface MemoryUsage {
	rss: number; // Resident Set Size
	heapTotal: number;
	heapUsed: number;
	external: number;
	arrayBuffers: number;
}

export class MemoryTracker {
	private baselineMemory?: MemoryUsage;

	constructor(private logger?: Logger) { }

	public setBaseline(): void {
		this.baselineMemory = this.getCurrentMemoryUsage();
		this.log("Memory baseline set", this.baselineMemory);
	}

	public getCurrentMemoryUsage(): MemoryUsage {
		const usage = process.memoryUsage();
		return {
			rss: usage.rss,
			heapTotal: usage.heapTotal,
			heapUsed: usage.heapUsed,
			external: usage.external,
			arrayBuffers: usage.arrayBuffers,
		};
	}

	public logCurrentUsage(context: string): MemoryUsage {
		const current = this.getCurrentMemoryUsage();
		const formatted = this.formatMemoryUsage(current);

		if (this.baselineMemory) {
			const diff = this.calculateDifference(this.baselineMemory, current);
			const formattedDiff = this.formatMemoryUsage(diff);
			this.log(`${context} - Current: ${formatted}, Diff from baseline: ${formattedDiff}`);
		} else {
			this.log(`${context} - Current: ${formatted}`);
		}

		return current;
	}

	public checkForMemoryLeaks(context: string, threshold: number = 50 * 1024 * 1024): boolean {
		const current = this.getCurrentMemoryUsage();

		if (this.baselineMemory) {
			const heapGrowth = current.heapUsed - this.baselineMemory.heapUsed;
			const arrayBufferGrowth = current.arrayBuffers - this.baselineMemory.arrayBuffers;

			if (heapGrowth > threshold || arrayBufferGrowth > threshold) {
				this.log(`⚠️  Potential memory leak detected in ${context}:`);
				this.log(`   Heap growth: ${this.formatBytes(heapGrowth)}`);
				this.log(`   ArrayBuffer growth: ${this.formatBytes(arrayBufferGrowth)}`);
				return true;
			}
		}

		return false;
	}

	public forceGarbageCollection(): void {
		if (global.gc) {
			this.log("Forcing garbage collection...");
			global.gc();
		} else {
			this.log("⚠️  Garbage collection not available. Run with --expose-gc flag.");
		}
	}

	private calculateDifference(baseline: MemoryUsage, current: MemoryUsage): MemoryUsage {
		return {
			rss: current.rss - baseline.rss,
			heapTotal: current.heapTotal - baseline.heapTotal,
			heapUsed: current.heapUsed - baseline.heapUsed,
			external: current.external - baseline.external,
			arrayBuffers: current.arrayBuffers - baseline.arrayBuffers,
		};
	}

	private formatMemoryUsage(usage: MemoryUsage): string {
		return [
			`RSS: ${this.formatBytes(usage.rss)}`,
			`Heap: ${this.formatBytes(usage.heapUsed)}/${this.formatBytes(usage.heapTotal)}`,
			`External: ${this.formatBytes(usage.external)}`,
			`ArrayBuffers: ${this.formatBytes(usage.arrayBuffers)}`,
		].join(", ");
	}

	private formatBytes(bytes: number): string {
		const sizes = ["B", "KB", "MB", "GB"];
		if (bytes === 0) return "0 B";
		const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024));
		const formatted = (bytes / Math.pow(1024, i)).toFixed(1);
		return `${formatted} ${sizes[i]}`;
	}

	private log(message: string, data?: any): void {
		if (this.logger) {
			const logMessage = data ? `${message} - ${JSON.stringify(data)}` : message;
			this.logger.info(`[MemoryTracker] ${logMessage}`, LogCategory.General);
		} else {
			console.log(`[MemoryTracker] ${message}`, data || "");
		}
	}
}

// Global memory tracker instance
export const globalMemoryTracker = new MemoryTracker();
