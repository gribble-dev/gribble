import { minimatch } from "minimatch";
import { RECOMMENDED_MODELS, type RecommendedModel } from "./recommended.js";

/** The recommendation entry matching a model, if any. */
export function recommendationFor(model: { provider: string; id: string }): RecommendedModel | undefined {
	let best: RecommendedModel | undefined;
	for (const entry of RECOMMENDED_MODELS) {
		if (entry.provider !== model.provider.toLowerCase()) continue;
		if (!minimatch(model.id.toLowerCase(), entry.idPattern.toLowerCase(), { nocase: true })) continue;
		if (!best || entry.rank < best.rank) best = entry;
	}
	return best;
}

/**
 * Stable sort: recommended models first (by rank, then by id descending so newer dated ids come first),
 * everything else in the original order.
 */
export function rankModels<T extends { provider: string; id: string }>(models: T[]): T[] {
	const scored = models.map((model, index) => ({ model, index, rec: recommendationFor(model) }));
	scored.sort((a, b) => {
		if (a.rec && b.rec) {
			if (a.rec.rank !== b.rec.rank) return a.rec.rank - b.rec.rank;
			return b.model.id.localeCompare(a.model.id) || a.index - b.index;
		}
		if (a.rec) return -1;
		if (b.rec) return 1;
		return a.index - b.index;
	});
	return scored.map((s) => s.model);
}
