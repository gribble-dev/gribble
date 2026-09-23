#!/usr/bin/env node
import { copy } from "./copy.js";
import { run } from "./index.js";
import { defaultRunContext } from "./ui.js";

// A consumer closing the pipe early (`gribble ... | head`) is not an error worth a stack trace.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
	if (err.code === "EPIPE") process.exit(0);
	throw err;
});

const controller = new AbortController();
let interrupts = 0;
process.on("SIGINT", () => {
	interrupts++;
	if (interrupts === 1) {
		process.stderr.write(`\n${copy.audit.interrupted}\n`);
		controller.abort();
		return;
	}
	process.stderr.write(`${copy.audit.interruptedAgain}\n`);
	process.exit(130);
});

const context = { ...defaultRunContext(), signal: controller.signal };
const code = await run(process.argv.slice(2), { context });
// Exit explicitly once the output is flushed. Waiting for the event loop to drain lets any handle
// that outlived the audit (a dev server orphan holding our pipes, a wedged browser connection)
// keep the process, and a CI job, alive for hours after the work is done.
const flushed = (stream: NodeJS.WriteStream) =>
	new Promise<void>((resolve) => {
		stream.write("", () => resolve());
	});
await Promise.all([flushed(process.stdout), flushed(process.stderr)]);
process.exit(code);
