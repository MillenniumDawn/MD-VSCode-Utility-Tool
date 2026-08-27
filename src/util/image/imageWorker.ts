// Runs inside a Node worker_threads worker (see imagedecoder.ts). Decodes DDS/TGA image buffers to
// PNG off the extension-host main thread. It reuses the same converter functions as the synchronous
// path, so the decode logic is not duplicated. MUST NOT import 'vscode': the converter/dds graph is
// vscode-free and this file has to stay that way (the worker runs in plain Node, not the host).
import { parentPort } from 'worker_threads';
import { PNG } from 'pngjs';
import { DDS } from './dds';
import { ddsToPng, tgaToPng } from './converter';

interface DecodeRequest {
    id: number;
    kind: 'dds' | 'tga';
    // A standalone ArrayBuffer (byteOffset 0) copied by the decoder before transfer.
    buffer: ArrayBuffer;
}

function decode(request: DecodeRequest): void {
    const port = parentPort;
    if (!port) {
        return;
    }

    try {
        let png: PNG;
        if (request.kind === 'dds') {
            png = ddsToPng(DDS.parse(request.buffer, 0));
        } else {
            png = tgaToPng(Buffer.from(request.buffer));
        }

        const pngBuffer = PNG.sync.write(png);
        // Copy into a private, exactly sized ArrayBuffer so transferring it back can never detach a
        // pooled Buffer still in use by this worker. The copy happens off the host's main thread.
        const out = pngBuffer.buffer.slice(pngBuffer.byteOffset, pngBuffer.byteOffset + pngBuffer.byteLength) as ArrayBuffer;
        port.postMessage({ id: request.id, png: out, width: png.width, height: png.height }, [out]);
    } catch (e) {
        const info = e instanceof Error ? { message: e.message, name: e.name } : { message: String(e), name: 'Error' };
        port.postMessage({ id: request.id, error: info });
    }
}

// Guarded so importing this module on a non-worker thread (e.g. to force tsc to compile it for a
// test) is a harmless no-op; the handler only attaches when actually spawned as a worker.
if (parentPort) {
    parentPort.on('message', decode);
}
