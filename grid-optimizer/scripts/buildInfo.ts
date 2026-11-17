import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Generate this once when Vite starts, so every asset from a deployment shares
// its identity. An extracted source archive still builds without a Git checkout.
export const createBuildInfo = (projectRoot: string, { env = process.env, now = new Date() }: {
    env?: Record<string, string | undefined>;
    now?: Date;
} = {}) => {
    const { version } = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
    const ciCommit = env.GITHUB_SHA?.trim();
    let revision = ciCommit && /^[0-9a-f]{7,64}$/i.test(ciCommit) ? ciCommit.slice(0, 8) : '';
    if (!revision) {
        try {
            revision = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], {
                cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
        } catch { /* Source archives have no Git metadata. */ }
    }
    return {
        version,
        revision: revision || `build-${now.getTime().toString(36)}`,
        builtAt: now.toISOString(),
    };
};
