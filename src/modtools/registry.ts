import { ModToolPack } from './api';

// Every mod pack the extension ships. A pack lives in packs/<id>/ and is added here, and nowhere
// else in the extension: host.ts is the only reader of this list.
export const modToolPacks: readonly ModToolPack[] = [];
