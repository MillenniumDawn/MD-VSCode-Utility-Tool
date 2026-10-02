'use strict';

const timers = require('timers/promises');

const endpoint = 'https://openrouter.ai/api/v1';
const defaultModel = 'z-ai/glm-5.2:free';
const timeoutMs = 120000;
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
