type TryRunErrorReporter = (error: unknown) => void;

let reporter: TryRunErrorReporter | undefined;

export function setTryRunErrorReporter(nextReporter: TryRunErrorReporter | undefined): void {
	reporter = nextReporter;
}

export function reportTryRunError(error: unknown): void {
	console.error(error);
	reporter?.(error);
}
