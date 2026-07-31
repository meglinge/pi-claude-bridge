/**
 * Regression tests for syncSharedSession's session reuse decisions.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { __test } = await import("../src/index.js");

describe("syncSharedSession", () => {
	afterEach(() => {
		__test.resetSharedSession();
	});

	it("does not reuse a cached main session for a shorter synthetic compact context", () => {
		const cwd = mkdtempSync(join(tmpdir(), "sync-shared-session-"));
		try {
			const mainSession = {
				sessionId: "11111111-1111-4111-8111-111111111111",
				cursor: 42,
				cwd,
			};
			__test.setSharedSession(mainSession);

			const result = __test.syncSharedSession([
				{
					role: "user",
					content: "Summarize this conversation.",
					timestamp: Date.now(),
				},
			], cwd);

			assert.equal(
				result.sessionId,
				null,
				"synthetic compact contexts have no prior messages and must start a fresh Claude Code session instead of resuming the main session",
			);
			assert.equal(
				result.preserveSharedSession,
				true,
				"the fresh synthetic Claude Code session must not replace the cached main session when it completes",
			);
			assert.deepEqual(__test.getSharedSession(), mainSession);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

	it("forces rebuild when Pi history shrinks below cursor but still has priors", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "sync-shared-session-"));
		try {
			// Pretend a previous turn left cursor=5, then prune/snapcompact left 2 priors + new user.
			__test.setSharedSession({
				sessionId: "22222222-2222-4222-8222-222222222222",
				cursor: 5,
				cwd,
			});

			const result = __test.syncSharedSession([
				{ role: "user", content: "first", timestamp: 1 },
				{
					role: "assistant",
					content: [{ type: "text", text: "hi" }],
					api: "claude-bridge",
					provider: "claude-bridge",
					model: "claude-opus-4-6",
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					stopReason: "stop",
					timestamp: 2,
				},
				{ role: "user", content: "second — should still see first", timestamp: 3 },
			], cwd);

			assert.notEqual(result.sessionId, null, "must rebuild/resume a session rather than clean-start");
			assert.notEqual(result.preserveSharedSession, true, "must not preserve-shared clean-start when priors exist");
			const state = __test.getSharedSession();
			assert.ok(state, "shared session retained");
			// After rebuild, cursor tracks the imported prior count (2), not the stale 5.
			assert.equal(state.cursor, 2);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

