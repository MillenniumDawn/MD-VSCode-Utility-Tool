'use strict';

const timers = require('timers/promises');

const endpoint = 'https://openrouter.ai/api/v1';
// Free, 256k context, and one of the few free models on OpenRouter that supports structured
// outputs and `seed`. Overridden by the OPENROUTER_MODEL repository variable.
const defaultModel = 'z-ai/glm-5.2:free';
const timeoutMs = 120000;
// Shared by rewrite-bullets (release job: 15 minutes) and close-fixed-issues (10 minutes). Six
// minutes leaves room for the release job's commit/push work and later issue-closing steps.
const modelBudgetMs = 6 * 60 * 1000;
const rateLimitWaitMs = 20000;

function modelName() {
	return process.env.OPENROUTER_MODEL?.trim() || defaultModel;
}

function createBudget(budgetMs = modelBudgetMs) {
	const deadline = Date.now() + budgetMs;
	return { signal: AbortSignal.timeout(budgetMs), remaining: () => deadline - Date.now() };
}

async function post(path, body, key, { budget, title }) {
	const response = await fetch(`${endpoint}${path}`, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${key}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': 'https://github.com/MillenniumDawn/MD-VSCode-Utility-Tool',
			'X-Title': title,
		},
		body: JSON.stringify(body),
		// The per-request timer bounds one call; the shared signal caps all tiers, retries, and fallbacks together.
		signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), budget.signal]),
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => '');
		const error = new Error(`OpenRouter returned ${response.status}: ${detail.slice(0, 300)}`);
		error.status = response.status;
		throw error;
	}

	return response.json();
}

function messageContent(payload) {
	return payload?.choices?.[0]?.message?.content ?? '';
}

function request(messages, maxTokens, extra) {
	return {
		model: modelName(),
		messages,
		// Keep the output stable across workflow reruns so already-seeded release wording does not drift.
		temperature: 0.2,
		seed: 7,
		max_tokens: maxTokens,
		...extra,
	};
}

async function withRateLimitRetry(call, budget) {
	try {
		return await call();
	} catch (error) {
		if (error?.status !== 429 || budget.signal.aborted || budget.remaining() <= rateLimitWaitMs) {
			throw error;
		}
		await timers.setTimeout(rateLimitWaitMs, undefined, { signal: budget.signal });
		if (budget.signal.aborted || budget.remaining() <= 0) {
			throw error;
		}
		return call();
	}
}

module.exports = { createBudget, endpoint, messageContent, modelBudgetMs, modelName, post, request, withRateLimitRetry };
