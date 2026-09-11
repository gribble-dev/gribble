// TODO(phase 2): owned by core-agent. Throwing stubs so dependants compile.
import type { CreateModelRuntime, LoginProvider, ResolveModel } from "./types.js";

export const createModelRuntime: CreateModelRuntime = async () => {
	throw new Error("createModelRuntime is not implemented yet");
};

export const resolveModel: ResolveModel = async () => {
	throw new Error("resolveModel is not implemented yet");
};

export const loginProvider: LoginProvider = async () => {
	throw new Error("loginProvider is not implemented yet");
};
