/*
GDream native-image ACP transport, adapted from @deepseek-ai/dsh-acp 0.1.0-rc.6.
Upstream node_modules is unchanged.

MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { Readable, Writable } from 'node:stream';
import Schema from '@deepseek-ai/schemastery';
import { AgentSideConnection, PROTOCOL_VERSION, RequestError, ndJsonStream } from '@agentclientprotocol/sdk';
import { SessionId } from '@deepseek-ai/dsh-session';
import { createUserMessage, errorChain } from '@deepseek-ai/dsh-llm';
import { nativeContent } from './gdream-native-images.mjs';
function turnEndToStopReason(reason) {
	switch (reason.kind) {
		case "completed": return "end_turn";
		case "max-tokens": return "max_tokens";
		case "aborted": return "cancelled";
		case "interrupted": return "cancelled";
		case "blocked": return "refusal";
		case "error": return "cancelled";
		/* v8 ignore next 2 -- TurnEndReason is closed and every member is handled above */
		default: return "end_turn";
	}
}
const name = "gdream-acp-native";
/** The bridge creates and owns agents; every other concern is carried by the agent composition. */
const inject = ["agents", "attachments"];
/** Preserve invalid-parameter detail in the SDK wire error message. */
function invalidParams(detail) {
	return RequestError.invalidParams(void 0, detail);
}
/** Preserve failed-turn detail; plain handler errors become a generic wire internal error. */
function internalError(detail) {
	return RequestError.internalError(void 0, detail);
}
const Config = Schema.object({
	provider: Schema.string(),
	model: Schema.string(),
	nativeImages: Schema.boolean().default(false)
});
/**
* Mount the automation-only ACP server.
* @param ctx - Cordis context carrying the agent factory and session events.
* @param config - Initial provider/model selection and optional test transport.
*/
function apply(ctx, config) {
	const agents = ctx.agents;
	const logger = ctx.logger;
	const sessions = /* @__PURE__ */ new Map();
	let closed = false;
	let conn;
	/** Return the bridge-owned record for an agent, rejecting same-id impostors. */
	const ownedRecord = (agent) => {
		const record = sessions.get(agent.session.id);
		return record?.agent === agent ? record : void 0;
	};
	const assertOpen = () => {
		if (closed) throw internalError("the ACP bridge has been disposed");
	};
	const requireSession = (sessionId) => {
		const record = sessions.get(sessionId);
		if (record === void 0) throw invalidParams(`unknown session: ${sessionId}`);
		return record;
	};
	/** Send a protocol update without letting a disconnected client fail an agent turn. */
	const notify = (notification) => {
		const record = sessions.get(notification.sessionId);
		/* v8 ignore next 3 -- only a transport write failure reaches this guard. */
		const delivery = conn.sessionUpdate(notification).catch((error) => {
			if (record) record.deliveryFailed = true;
			logger.warn(`acp: session/update failed: ${String(error)}`);
		});
		if (record) {
			record.pendingUpdates.add(delivery);
			void delivery.then(() => record.pendingUpdates.delete(delivery));
		}
	};
	const settlePrompt = (record, reason) => {
		const inflight = record.inflight;
		if (inflight === void 0) return;
		record.inflight = void 0;
		inflight.resolve(reason);
	};
	const rejectFromError = (inflight, reason) => {
		inflight.reject(internalError(`turn failed: ${reason.error.message}`));
	};
	ctx.on("session/event", (session, event) => {
		const record = sessions.get(session.header.id);
		if (record === void 0 || record.agent.session !== session) return;
		try {
			if (event.type === "assistant/message") {
				for (const block of event.data.message.content) if (block.type === "text" && block.text.length > 0) notify({
					sessionId: record.agent.session.id,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: {
							type: "text",
							text: block.text
						}
					}
				});
				else if (block.type === "image") notify({
					sessionId: record.agent.session.id,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: {
							type: "text",
							text: `[image attachment ${block.attachment.attachmentId}]`
						}
					}
				});
			}
		} finally {
			const inflight = record.inflight;
			if (inflight !== void 0 && event.type === "turn/end" && inflight.turn === event.data.turn) if (event.data.reason.kind === "error") {
				record.inflight = void 0;
				rejectFromError(inflight, event.data.reason);
			} else inflight.endReason = event.data.reason;
		}
	});
	ctx.on("agent/inbox/claimed", ({ agent, message, turn }) => {
		const inflight = ownedRecord(agent)?.inflight;
		if (inflight !== void 0 && inflight.messageId === message.id) inflight.turn = turn;
	});
	ctx.on("agent/error", ({ agent, turn, error }) => {
		const record = ownedRecord(agent);
		const inflight = record?.inflight;
		if (record === void 0 || inflight === void 0 || inflight.turn === turn) return;
		record.inflight = void 0;
		inflight.reject(internalError(`turn failed: ${errorChain(error)}`));
	});
	ctx.on("approval/request", (request, next) => {
		const record = ownedRecord(request.agent);
		if (record === void 0 || request.callId === void 0) return next();
		return conn.requestPermission({
			sessionId: record.agent.session.id,
			toolCall: { toolCallId: request.callId },
			options: [{
				optionId: "allow-once",
				name: "Allow once",
				kind: "allow_once"
			}, {
				optionId: "reject-once",
				name: "Reject",
				kind: "reject_once"
			}]
		}).then(({ outcome }) => {
			if (outcome.outcome === "cancelled") return "cancelled";
			return outcome.optionId === "allow-once" ? "allowed-once" : "rejected";
		});
	});
	const makeAgent = (connection) => {
		conn = connection;
		return {
			initialize(_params) {
				return Promise.resolve({
					protocolVersion: PROTOCOL_VERSION,
					agentInfo: {
						name: "deepseek-harness-acp",
						version: "0.0.1"
					},
					agentCapabilities: { promptCapabilities: {
						image: config.nativeImages,
						audio: false,
						embeddedContext: false
					} },
					authMethods: []
				});
			},
			authenticate(_params) {
				return Promise.resolve();
			},
			async newSession(params) {
				assertOpen();
				validateSessionParams(params);
				const sessionId = SessionId(randomUUID());
				const handle = await agents.create({
					sessionId,
					meta: { cwd: params.cwd },
					agentOptions: agentOptions(config)
				});
				/* v8 ignore next 4 -- a real stdio close can race an in-flight create. */
				if (closed) {
					await handle.dispose();
					throw internalError("connection closed during session/new");
				}
				sessions.set(sessionId, {
					agent: handle.agent,
					dispose: () => handle.dispose(),
					pendingUpdates: new Set(),
					deliveryFailed: false,
					inflight: void 0
				});
				return { sessionId };
			},
			async prompt(params) {
				assertOpen();
				const record = requireSession(SessionId(params.sessionId));
				if (record.inflight !== void 0) throw invalidParams("a prompt is already in flight for this session");
                if (params.prompt.some((block) => !['text', 'image', 'resource_link'].includes(block.type))) throw invalidParams('Unsupported media: native video/audio is not supported by this transport');
                if (!config.nativeImages && params.prompt.some((block) => block.type === 'image')) throw invalidParams('当前渠道不支持原生图片输入，请选择支持图片的模型');
                // Reserve the session before asynchronous image admission.
                if (record.preparing) throw invalidParams('a prompt is already in flight for this session');
                record.preparing = true;
                let content;
                try { content = await nativeContent(params.prompt, ctx.attachments); }
                catch (error) { record.cancelledDuringPrepare = false; throw invalidParams(error instanceof Error ? error.message : String(error)); }
                finally { record.preparing = false; }
                assertOpen();
                if (record.cancelledDuringPrepare) { record.cancelledDuringPrepare = false; return { stopReason: 'cancelled' }; }
                if (!content.some((block) => block.type === 'image' || (block.type === 'text' && block.text.trim()))) throw invalidParams('empty prompt');
                if (ctx.agents.get(record.agent.id) !== record.agent) throw internalError('agent disposed');
                const message = createUserMessage({ content, source: { kind: 'user' } });
				return { stopReason: await new Promise((resolve, reject) => {
					const inflight = {
						resolve,
						reject,
						messageId: message.id,
						turn: void 0,
						endReason: void 0
					};
					record.inflight = inflight;
					try {
						record.agent.followup(message);
					} catch (error) {
						record.inflight = void 0;
						throw internalError(`prompt was not queued: ${error instanceof Error ? error.message : String(error)}`);
					}
					/* v8 ignore stop */
					record.agent.whenIdle().then(async () => {
						await Promise.all([...record.pendingUpdates]);
						if (record.inflight !== inflight) return;
						record.inflight = void 0;
						const end = inflight.endReason;
						if (record.deliveryFailed) inflight.reject(internalError('assistant output delivery failed'));
						else if (end === void 0) inflight.resolve("cancelled");
						else inflight.resolve(turnEndToStopReason(end));
					}).catch((error) => {
						if (record.inflight !== inflight) return;
						record.inflight = void 0;
						inflight.reject(internalError(`turn failed: ${errorChain(error)}`));
					});
				}) };
			},
			cancel(params) {
				const record = sessions.get(SessionId(params.sessionId));
				if (record === void 0) return Promise.resolve();
				if (record.preparing) record.cancelledDuringPrepare = true;
				record.agent.cancel({ kind: "user" });
				settlePrompt(record, "cancelled");
				return Promise.resolve();
			}
		};
	};
	conn = new AgentSideConnection(makeAgent, config.stream ?? ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
	let quiescing;
	const quiesce = () => {
		if (quiescing !== void 0) return quiescing;
		closed = true;
		const records = [...sessions.values()];
		sessions.clear();
		for (const record of records) {
			record.agent.cancel({ kind: "user" });
			settlePrompt(record, "cancelled");
		}
		quiescing = (async () => {
			const subagents = ctx.get("subagents");
			if (subagents !== void 0) try {
				await subagents.drainContinuableDescendants(records.map((record) => record.agent));
			} catch (error) {
				logger.warn(`acp: continuable subagent teardown failed: ${String(error)}`);
			}
			const disposals = await Promise.allSettled(records.map((record) => record.dispose()));
			const failures = [];
			for (const result of disposals) if (result.status === "rejected") failures.push(result.reason);
			if (failures.length > 0) {
				const detail = failures.map((failure) => errorChain(failure)).join("; ");
				throw new AggregateError(failures, `ACP agent teardown failed for ${failures.length} session(s): ${detail}`);
			}
		})();
		return quiescing;
	};
	/* v8 ignore start -- production transport rejection and teardown failure. */
	conn.closed.catch((error) => {
		logger.warn(`acp: connection closed with an error: ${String(error)}`);
	}).then(quiesce).catch((error) => {
		logger.warn(`acp: connection-close teardown failed: ${String(error)}`);
	});
	/* v8 ignore stop */
	ctx.effect(() => quiesce, "acp.connection");
}
/**
* Build per-agent options from plugin config without assigning absent optional fields.
* @param config - ACP provider/model configuration.
* @returns the configured fields only.
*/
function agentOptions(config) {
	return {
		...config.provider !== void 0 ? { provider: config.provider } : {},
		...config.model !== void 0 ? { model: config.model } : {}
	};
}
/** Reject session features outside the automation contract. */
function validateSessionParams(params) {
	if (!isAbsolute(params.cwd)) throw invalidParams(`cwd must be an absolute path: ${params.cwd}`);
	if (params.additionalDirectories !== void 0 && params.additionalDirectories.length > 0) throw invalidParams("additionalDirectories is not supported");
	if (params.mcpServers.length > 0) throw invalidParams("mcpServers is not supported");
}
//#endregion
export { Config, apply, inject, name };
