// Waits until a condition holds, checking it every few milliseconds, instead of sleeping a fixed
// span and asserting afterwards. A fixed sleep is the standard flake on a busy runner: long enough
// on a quiet machine, a few milliseconds short on a loaded one. Polling passes as soon as the
// condition is true and only fails once the ceiling is reached -- so the ceiling can be generous
// without making a passing test slow.
//
// Only a condition that becomes true can be waited for. "Nothing appeared" cannot be polled; a
// test asserting that still has to wait out the delay it is asserting against.
export async function waitFor(
    condition: () => boolean,
    options: { timeout?: number; step?: number; message?: string } = {},
): Promise<void> {
    const timeout = options.timeout ?? 2000;
    const step = options.step ?? 10;
    const deadline = Date.now() + timeout;
    for (;;) {
        if (condition()) {
            return;
        }
        if (Date.now() >= deadline) {
            throw new Error(options.message ?? `Condition not met within ${timeout}ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, step));
    }
}
