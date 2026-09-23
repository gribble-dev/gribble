/**
 * Copies text to the clipboard. If the Clipboard API is unavailable or refused, selects the
 * text in `fallback` so the reader can copy it by hand, and reports `false`.
 */
export async function copyText(text: string, fallback?: HTMLElement | null): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		if (fallback) {
			const range = document.createRange();
			range.selectNodeContents(fallback);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
		}
		return false;
	}
}
