import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";

const repoRoot = path.join(__dirname, "..", "..", "..", "..", "..");
const readRepoJson = (file: string): Record<string, unknown> =>
	JSON.parse(fs.readFileSync(path.join(repoRoot, file), "utf8"));

function vsceRequire(): NodeRequire {
	const projectRequire = createRequire(path.join(repoRoot, "package.json"));
	return createRequire(projectRequire.resolve("@vscode/vsce/package.json"));
}

describe("patched @azure/msal-node resolution", () => {
	it("keeps the override scoped to @azure/identity", () => {
		const overrides = readRepoJson("package.json")["overrides"] as Record<string, Record<string, string>>;
		assert.deepStrictEqual(overrides["@azure/identity"], { "@azure/msal-node": "^7.1.0" });
	});

	it("patches every npm v2 lockfile package copy", () => {
		const lock = readRepoJson("package-lock.json");
		const packages = lock["packages"] as Record<string, { version?: string }>;
		const versions = Object.entries(packages)
			.filter(([packagePath]) => /(?:^|\/)node_modules\/@azure\/msal-node$/.test(packagePath))
			.map(([, entry]) => entry.version);
		assert.ok(versions.length > 0, "lockfile has no @azure/msal-node package entries");
		const semver = vsceRequire()("semver") as { gte(version: string, range: string): boolean };
		for (const version of versions) {
			assert.strictEqual(typeof version, "string");
			assert.ok(semver.gte(version as string, "7.1.0"), `unpatched @azure/msal-node ${version}`);
		}
	});
});

describe("@azure/identity with patched @azure/msal-node", () => {
	it("gets a client-secret token through the real credential and mocked transport", async () => {
		const packageRequire = vsceRequire();
		const identityPath = packageRequire.resolve("@azure/identity/package.json");
		const identityRequire = createRequire(identityPath);
		const { ClientSecretCredential } = identityRequire("@azure/identity") as {
			ClientSecretCredential: new (tenant: string, client: string, secret: string, options: object) => {
				getToken(scopes: string[]): Promise<{ token: string; expiresOnTimestamp: number } | null>;
			};
		};
		const pipelinePath = identityRequire.resolve("@azure/core-rest-pipeline/package.json");
		const pipelineRequire = createRequire(pipelinePath);
		const { createHttpHeaders } = pipelineRequire("@azure/core-rest-pipeline") as {
			createHttpHeaders(headers: Record<string, string>): unknown;
		};
		const requests: Array<{ url: string; method: string; body?: unknown }> = [];
		const httpClient = {
			async sendRequest(request: { url: string; method: string; body?: unknown }) {
				requests.push(request);
				assert.match(request.url, /^https:\/\/login\.microsoftonline\.com\/test-tenant\//);
				assert.strictEqual(request.method, "POST");
				return {
					request,
					status: 200,
					headers: createHttpHeaders({ "content-type": "application/json" }),
					bodyAsText: JSON.stringify({
						token_type: "Bearer",
						expires_in: 3600,
						ext_expires_in: 3600,
						access_token: "mock-access-token",
					}),
				};
			},
		};
		const credential = new ClientSecretCredential("test-tenant", "client-id", "client-secret", {
			httpClient,
			disableInstanceDiscovery: true,
		});
		const token = await credential.getToken(["https://example.test/.default"]);
		assert.strictEqual(token?.token, "mock-access-token");
		assert.ok(token?.expiresOnTimestamp);
		assert.strictEqual(requests.length, 1);
		assert.match(requests[0].url, /oauth2\/v2\.0\/token(?:\?|$)/);
		assert.match(String(requests[0].body), /client_secret=client-secret/);
	});
});
