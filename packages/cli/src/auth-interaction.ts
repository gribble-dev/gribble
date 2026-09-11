import type { AuthEvent, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";
import { copy } from "./copy.js";
import type { Prompter } from "./prompts.js";

/**
 * pi's login flows talk to the user through an `AuthInteraction`. This one answers with clack
 * prompts and prints auth URLs / device codes to the terminal (no browser is opened for the user).
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
					return prompter.text({ message: prompt.message, placeholder: prompt.placeholder });
				case "secret":
					return prompter.secret({ message: prompt.message, placeholder: prompt.placeholder });
				case "manual_code":
					return prompter.text({ message: prompt.message, placeholder: prompt.placeholder });
				case "select":
					return prompter.select({
						message: prompt.message,
						options: prompt.options.map((o) => ({ value: o.id, label: o.label, hint: o.description })),
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
					const lines = [copy.login.openUrl, event.url];
					if (event.instructions) lines.push(event.instructions);
					prompter.note(lines.join("\n"));
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
