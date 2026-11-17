import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { createBuildInfo } from '../scripts/buildInfo.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const now = new Date('2026-11-17T01:23:45.678Z');
const ciCommit = 'abcdef0123456789abcdef0123456789abcdef01';

test('build metadata uses package version and the exact CI commit, without changing with browser time', () => {
    assert.deepEqual(createBuildInfo(projectRoot, { env: { GITHUB_SHA: ciCommit }, now }), {
        version, revision: 'abcdef01', builtAt: '2026-11-17T01:23:45.678Z',
    });
});

test('local builds identify the checked-out commit when CI metadata is absent or malformed', () => {
    const revision = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
    assert.equal(createBuildInfo(projectRoot, { env: {}, now }).revision, revision);
    assert.equal(createBuildInfo(projectRoot, { env: { GITHUB_SHA: 'not a commit' }, now }).revision, revision);
});

test('source archives without Git receive distinct build identifiers and retain the release version', () => {
    const archive = mkdtempSync(join(tmpdir(), 'optimizer-build-info-'));
    try {
        writeFileSync(join(archive, 'package.json'), JSON.stringify({ version }));
        const first = createBuildInfo(archive, { env: {}, now });
        const next = createBuildInfo(archive, { env: {}, now: new Date(now.getTime() + 1) });
        assert.equal(first.version, version);
        assert.match(first.revision, /^build-[a-z0-9]+$/);
        assert.notEqual(first.revision, next.revision);
    } finally { rmSync(archive, { recursive: true, force: true }); }
});

test('the production page embeds its version and CI identity with no unresolved runtime constant', async () => {
    const previousSha = process.env.GITHUB_SHA;
    process.env.GITHUB_SHA = ciCommit;
    try {
        const result = await build({ root: projectRoot, logLevel: 'silent', build: { write: false, minify: false } });
        const code = [result].flat().flatMap(bundle => bundle.output).filter(chunk => chunk.type === 'chunk' && chunk.isEntry).map(chunk => chunk.code).join('\n');
        assert.ok(code.includes(version));
        assert.ok(code.includes('abcdef01'));
        assert.ok(code.includes('data-build-version'));
        assert.ok(code.includes('data-build-id'));
        assert.doesNotMatch(code, /\b__BUILD_INFO__\b|execFileSync|rev-parse/);
    } finally {
        if (previousSha === undefined) delete process.env.GITHUB_SHA;
        else process.env.GITHUB_SHA = previousSha;
    }
});
