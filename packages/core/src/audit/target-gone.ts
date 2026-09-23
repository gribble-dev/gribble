/**
 * The circuit breaker for a target that stops answering mid-audit: a managed dev server that
 * exits, or N consecutive routes refused at the socket. Auditing on would only produce a report
 * full of `network/page-error` and "fixed" baseline findings, so the audit stops instead.
 */

/** Navigation errors that mean nothing is listening, as opposed to a page that answered badly. */
const CONNECTION_ERROR =
	/\b(?:net::ERR_(?:CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_FAILED|EMPTY_RESPONSE|ADDRESS_UNREACHABLE|SOCKET_NOT_CONNECTED)|ECONNREFUSED|ECONNRESET)\b/;

/** True when a navigation or fetch error says the server is not there. */
export function isConnectionError(message: string | undefined): boolean {
	return !!message && CONNECTION_ERROR.test(message);
}

/** True when anything answers HTTP at `url`, whatever the status: someone is listening. */
export async function urlAnswers(url: string, timeoutMs = 3_000): Promise<boolean> {
	try {
		const res = await fetch(url, {
			method: "GET",
			redirect: "manual",
			signal: AbortSignal.timeout(timeoutMs),
		});
		await res.body?.cancel().catch(() => {});
		return true;
	} catch {
		return false;
	}
}

/** The target stopped answering part-way through the audit. Not a finding: the run is void. */
export class TargetGoneError extends Error {
	override readonly name = "TargetGoneError";
	/** The last lines the managed dev server printed; empty when Gribble did not start it. */
	readonly output: string[];

	constructor(message: string, output: string[] = []) {
		super(message);
		this.output = output;
	}
}

/** Counts consecutive route navigations that failed with a connection error. */
export class ConnectionFailureCounter {
	private streak = 0;
	private last: string | undefined;

	/** `limit` 0 disables the breaker. */
	constructor(private readonly limit: number) {}

	/** Record one navigation; returns true once `limit` consecutive ones were refused. */
	record(error: string | undefined): boolean {
		const match = error?.match(CONNECTION_ERROR);
		if (!match) {
			this.streak = 0;
			return false;
		}
		this.streak++;
		this.last = match[0];
		return this.limit > 0 && this.streak >= this.limit;
	}

	reset(): void {
		this.streak = 0;
	}

	count(): number {
		return this.streak;
	}

	/** The last error code seen, e.g. `net::ERR_CONNECTION_REFUSED`. */
	lastError(): string | undefined {
		return this.last;
	}
}
