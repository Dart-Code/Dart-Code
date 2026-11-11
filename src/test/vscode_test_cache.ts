import * as vstest from "@vscode/test-electron";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const lockHeartbeatMs = 60 * 1000;
const staleLockMs = 5 * 60 * 1000;

/**
 * Downloads and extracts VS Code for test runs, optionally sharing `stable`
 * builds in `sharedCachePath` across working directories/worktrees while
 * serializing concurrent downloads via filesystem lock files.
 */
export class VsCodeTestCache {
	private readonly sharedCachePath: string | undefined;

	constructor(sharedCachePath = process.env.VSCODE_TEST_CACHE_PATH) {
		this.sharedCachePath = sharedCachePath ? path.resolve(sharedCachePath) : undefined;
	}

	public async downloadAndUnzipVSCode(options: Partial<vstest.DownloadOptions>): Promise<string> {
		// Only share VSCODE_TEST_CACHE_PATH for stable builds, which extract into
		// versioned folders (`vscode-<platform>-<x.y.z>`). Insiders extracts into an
		// unversioned `vscode-<platform>-insiders` folder and deletes/replaces it
		// in-place when updated, which could collide with a running test process.
		const cachePath = options.cachePath ?? ((!options.version || options.version === "stable")
			? this.sharedCachePath
			: undefined);

		if (!cachePath)
			return vstest.downloadAndUnzipVSCode(options);

		const releaseLock = await this.acquireLock(path.join(cachePath, ".vscode-download-locks"));
		try {
			return await vstest.downloadAndUnzipVSCode({ ...options, cachePath });
		} finally {
			await releaseLock();
		}
	}

	private async acquireLock(locksDir: string): Promise<() => Promise<void>> {
		const ownerInfo = `active\n${os.hostname()}\n${process.pid}`;

		while (true) {
			fs.mkdirSync(locksDir, { recursive: true });

			const existing = await this.getActiveLocks(locksDir);
			if (existing.size > 0) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
				continue;
			}

			// Give each attempt its own uniquely-named candidate file so cleaning up
			// a stale lock file can never delete another caller's newly-created lock.
			const lockName = `${process.pid}-${crypto.randomUUID()}.lock`;
			const lockPath = path.join(locksDir, lockName);
			fs.writeFileSync(lockPath, ownerInfo, { flag: "wx" });

			const heartbeat = setInterval(() => {
				try {
					const now = new Date();
					fs.utimesSync(lockPath, now, now);
				} catch {
					// Ignore transient lock contention (such as Windows AV scanners);
					// subsequent ticks will refresh well before staleLockMs expires.
				}
			}, lockHeartbeatMs);
			heartbeat.unref();

			const releaseCandidate = async () => {
				clearInterval(heartbeat);
				try {
					const fd = fs.openSync(lockPath, "r+");
					try {
						fs.writeSync(fd, "released\n", 0, "utf8");
					} finally {
						fs.closeSync(fd);
					}
				} catch {
					// Ignore if already removed or inaccessible.
				}
				await this.tryDeleteLockFile(lockPath);
			};

			// Re-scan after publishing our candidate file. Because every caller writes
			// its file before scanning and retains it until exiting, at most one caller
			// can observe itself as the sole active lock; any concurrent or delayed
			// caller will see multiple active files and back off.
			let acquired = false;
			try {
				const active = await this.getActiveLocks(locksDir);
				if (active.size === 1 && active.has(lockName)) {
					acquired = true;
					return releaseCandidate;
				}
			} finally {
				if (!acquired)
					await releaseCandidate();
			}

			await new Promise((resolve) => setTimeout(resolve, crypto.randomInt(50, 250)));
		}
	}

	private async getActiveLocks(locksDir: string): Promise<Set<string>> {
		let entries: string[];
		try {
			entries = fs.readdirSync(locksDir).filter((name) => name.endsWith(".lock"));
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === "ENOENT")
				return new Set();
			throw e;
		}

		const active = new Set<string>();
		for (const entry of entries) {
			const entryPath = path.join(locksDir, entry);
			if (this.isLockStale(entryPath)) {
				await this.tryDeleteLockFile(entryPath);
				continue;
			}
			active.add(entry);
		}
		return active;
	}

	private isLockStale(lockFile: string): boolean {
		try {
			const stat = fs.statSync(lockFile);
			if (Date.now() - stat.mtimeMs > staleLockMs)
				return true;

			const content = fs.readFileSync(lockFile, "utf8");
			if (content.startsWith("released\n"))
				return true;

			const [status, hostname, pidText] = content.trim().split("\n");
			if (status === "active" && hostname === os.hostname()) {
				const pid = parseInt(pidText, 10);
				if (!isNaN(pid) && pid > 0) {
					try {
						process.kill(pid, 0);
						return false;
					} catch (e) {
						if ((e as NodeJS.ErrnoException).code === "ESRCH")
							return true;
					}
				}
			}
			return false;
		} catch (e) {
			// Already removed by its owner or another caller.
			return (e as NodeJS.ErrnoException).code === "ENOENT";
		}
	}

	private async tryDeleteLockFile(lockFile: string): Promise<void> {
		try {
			await fs.promises.rm(
				lockFile,
				{
					force: true,
					recursive: true,
					// Windows can take a little time to release file handles.
					maxRetries: 10,
					retryDelay: 500,
				},
			);
		} catch (e) {
			console.warn(`Failed to clean up lock file ${lockFile}: ${String(e)}`);
		}
	}
}
