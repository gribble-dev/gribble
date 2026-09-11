// See https://svelte.dev/docs/kit/types#app.d.ts

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env?: Record<string, unknown>;
			cf?: Record<string, unknown>;
			ctx?: { waitUntil(promise: Promise<unknown>): void };
		}
	}
}

export {};
