// Test-only worker_threads entry standing in for an image decode worker wedged inside a decode: it
// accepts every job and never answers, so imagedecoder.test.ts can exercise the dispose and timeout
// paths without a real pathological texture.
import { parentPort } from "worker_threads";

if (parentPort) {
	parentPort.on("message", () => undefined);
}
