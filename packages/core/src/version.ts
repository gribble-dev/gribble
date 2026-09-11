import pkg from "../package.json" with { type: "json" };

/** Version of @gribble/core, read from package.json at build time. */
export const GRIBBLE_CORE_VERSION: string = pkg.version;
