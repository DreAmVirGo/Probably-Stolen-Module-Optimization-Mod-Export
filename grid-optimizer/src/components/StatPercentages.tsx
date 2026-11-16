import type { Stats } from '../types';
import { t, useLang } from '../i18n';
import { formatStatValue, getStatColor } from '../utils';

const STATS = ['Performance', 'Quality', 'Efficiency'] as const;

// Keep the machine's three module totals visible independently of its outcome
// cards: an ignored stat or a combined goal still has its own percentage here.
export const StatPercentages = ({ totals, width }: { totals: Stats; width?: number }) => {
    useLang();
    return (
        <dl style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            width: width ?? '100%', maxWidth: '100%', alignSelf: 'center',
            boxSizing: 'border-box', margin: 0, padding: '6px 0',
            backgroundColor: '#1a1a1a', border: '1px solid #2c2c2c', borderRadius: '6px',
        }}>
            {STATS.map((stat, index) => (
                <div key={stat} style={{
                    minWidth: 0, padding: '0 4px', textAlign: 'center',
                    borderLeft: index > 0 ? '1px solid #2c2c2c' : undefined,
                }}>
                    <dt style={{ fontSize: '0.65em', color: '#8a8a8a', lineHeight: 1.4 }}>{t(stat)}</dt>
                    <dd style={{
                        margin: '2px 0 0', fontSize: '0.95em', fontWeight: 600,
                        color: getStatColor(totals[stat]), fontVariantNumeric: 'tabular-nums',
                        overflowWrap: 'anywhere',
                    }}>
                        {formatStatValue(totals[stat])}
                    </dd>
                </div>
            ))}
        </dl>
    );
};
