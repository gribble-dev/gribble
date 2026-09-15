import type { AuthEvent, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";
import { copy } from "./copy.js";
import type { Prompter } from "./prompts.js";

/**
 * pi's login flows talk to the user through an `AuthInteraction`. This one answers with clack
 * prompts and prints auth URLs / device codes to the terminal (no browser is opened for the user).
 *
 * Every prompt forwards pi's `signal`: the OAuth flows race a "paste the code here" prompt
 * against a localhost callback server and abort the prompt once the browser redirect wins.
 * Without that the prompt would keep stdin open and the process alive after the login is done.
 */
export function createAuthInteraction(
	prompter: Prompter,
	opts: { signal?: AbortSignal } = {},
): AuthInteraction {
	return {
		signal: opts.signal,
		async prompt(prompt: AuthPrompt): Promise<string> {
			switch (prompt.type) {
				case "text":
				case "manual_code":
					return prompter.text({
						message: prompt.message,
						placeholder: prompt.placeholder,
						signal: prompt.signal,
					});
				case "secret":
					return prompter.secret({
						message: prompt.message,
						placeholder: prompt.placeholder,
						signal: prompt.signal,
					});
				case "select":
					return prompter.select({
						message: prompt.message,
						options: prompt.options.map((o) => ({ value: o.id, label: o.label, hint: o.description })),
						signal: prompt.signal,
					});
			}
		},
		notify(event: AuthEvent): void {
			switch (event.type) {
				case "info": {
					const links = event.links?.map((l) => (l.label ? `${l.label}: ${l.url}` : l.url)) ?? [];
					prompter.info([event.message, ...links].join("\n"));
					return;
				}
				case "auth_url": {
					// Not a note: clack hard-wraps note bodies into a box, which breaks a long URL when
					// it is copied out of the terminal. `info` leaves the line to the terminal.
					const lines = [copy.login.openUrl, event.url];
					if (event.instructions) lines.push(event.instructions);
					prompter.info(lines.join("\n"));
					return;
				}
				case "device_code": {
					const lines = [copy.login.deviceCode(event.verificationUri, event.userCode)];
					if (event.expiresInSeconds)
						lines.push(`The code expires in ${Math.round(event.expiresInSeconds / 60)} minutes.`);
					prompter.note(lines.join("\n"));
					return;
				}
				case "progress":
					prompter.step(event.message);
					return;
			}
		},
	};
}
