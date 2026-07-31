// Host-compat helpers for stock Pi and Oh My Pi (OMP).
//
// OMP rewrites `@earendil-works/pi-coding-agent` to a legacy shim. Older OMP
// builds omit exports such as `compact` / `CONFIG_DIR_NAME`, and Bun's plugin
// validator rejects static named imports of missing exports before the
// extension can load. Resolve those symbols dynamically / softly instead.

import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

type CompactFn = (...args: any[]) => Promise<any>;

let codingAgentModPromise: Promise<any> | undefined;
let compactFn: CompactFn | null | undefined;

async function loadCodingAgentMod(): Promise<any> {
	if (!codingAgentModPromise) {
		codingAgentModPromise = import("@earendil-works/pi-coding-agent").catch((err) => {
			codingAgentModPromise = undefined;
			throw err;
		});
	}
	return codingAgentModPromise;
}

/** Soft project-config directory name (".omp" on OMP, ".pi" on stock Pi). */
export function resolveConfigDirName(): string {
	// Prefer a live binding when the host exports it (no static named import).
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const syncHint = (globalThis as any).__claudeBridgeCodingAgent;
		if (syncHint && typeof syncHint.CONFIG_DIR_NAME === "string" && syncHint.CONFIG_DIR_NAME) {
			return syncHint.CONFIG_DIR_NAME;
		}
	} catch {
		/* ignore */
	}
	try {
		// getAgentDir is widely exported; infer from its path.
		// Dynamic path avoided here so loadConfig stays sync.
	} catch {
		/* ignore */
	}
	const home = homedir();
	if (existsSync(join(home, ".omp", "agent")) || existsSync(join(home, ".omp"))) return ".omp";
	if (process.env.OMP_HOME || process.env.OH_MY_PI) return ".omp";
	return ".pi";
}

/**
 * Resolve host `compact`. Returns null when the OMP/Pi shim does not export it
 * (install validation must not depend on this symbol existing).
 */
export async function resolveCompact(): Promise<CompactFn | null> {
	if (compactFn !== undefined) return compactFn;
	try {
		const mod = await loadCodingAgentMod();
		(globalThis as any).__claudeBridgeCodingAgent = mod;
		compactFn = typeof mod.compact === "function" ? (mod.compact as CompactFn) : null;
	} catch {
		compactFn = null;
	}
	return compactFn;
}

export type BridgeCompactArgs = {
	preparation: unknown;
	model: unknown;
	customInstructions?: string;
	signal?: AbortSignal;
	/** Pi-style custom summarizer stream (bridge isolatedStreamFn). */
	streamFn?: unknown;
};

/**
 * Call host compact with Pi or OMP argument layouts.
 * - Stock Pi: (prep, model, apiKey, headers, customInstructions, signal, thinking, streamFn, env)
 * - OMP:      (prep, model, apiKey, customInstructions?, signal?, options?)
 */
export async function runBridgeCompact(args: BridgeCompactArgs): Promise<any> {
	const compact = await resolveCompact();
	if (!compact) {
		throw new Error(
			"Host pi-coding-agent does not export compact(); update OMP (legacy shim) or disable bridge compact takeover",
		);
	}

	// function.length ignores optional params in some builds; prefer heuristics.
	const arity = compact.length;
	if (arity > 0 && arity <= 6) {
		// OMP-style shorter signature. Custom streamFn is not in the same slot;
		// pass what we can and let the host default summarizer run if needed.
		return await compact(
			args.preparation,
			args.model,
			undefined,
			args.customInstructions,
			args.signal,
			args.streamFn ? { completeImpl: args.streamFn } : undefined,
		);
	}

	// Stock Pi / full legacy arity (streamFn near the end).
	return await compact(
		args.preparation,
		args.model,
		undefined, // apiKey
		undefined, // headers
		args.customInstructions,
		args.signal,
		undefined, // thinkingLevel
		args.streamFn,
		undefined, // env
	);
}
