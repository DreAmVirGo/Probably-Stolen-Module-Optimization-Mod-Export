import { t, useLang } from '../i18n';

// Replaced by Vite at build time; it never depends on the viewer's clock or a
// request to GitHub, so cached deployments keep their own version information.
declare const __BUILD_INFO__: { version: string; revision: string; builtAt: string };
const { version, revision, builtAt } = __BUILD_INFO__;
const utcTime = builtAt.replace('T', ' ').replace(/\.\d{3}Z$/, '');

export const BuildVersion = () => {
    useLang();
    return (
        <span data-build-version={version} data-build-id={revision}
            title={t('Built {time} (UTC)', { time: utcTime })}
            style={{ flexBasis: '100%', textAlign: 'right', color: '#888', overflowWrap: 'anywhere' }}>
            {t('Version')}{' '}<code>v{version} · {revision}</code>
        </span>
    );
};
