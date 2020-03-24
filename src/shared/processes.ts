import * as child_process from "child_process";
import { SpawnedProcess } from "./interfaces";

export function safeSpawn(workingDirectory: string | undefined, binPath: string, args: string[], env: { envOverrides?: any, toolEnv: {} }): SpawnedProcess {
	// Spawning processes on Windows with funny symbols in the path requires quoting. However if you quote an
	// executable with a space in its path and an argument also has a space, you have to then quote all of the
	// arguments too!\
	// https://github.com/nodejs/node/issues/7367
	const customEnv = env.envOverrides
		? Object.assign(Object.create(env.toolEnv), env.envOverrides) // Do it this way so we can override toolEnv if required.
		: env.toolEnv;
	const quotedArgs = args.map((a) => `"${a.replace(/"/g, `\\"`)}"`);
	return child_process.spawn(`"${binPath}"`, quotedArgs, { cwd: workingDirectory, env: customEnv, shell: true }) as SpawnedProcess;
}
