// Appearance: light/dark/auto, accent colour and text size. Saved on this device and applied instantly.
import { useTranslation } from 'react-i18next';
import { useApp, type Accent, type TextSize } from '@/state/app';
import { Icon } from './Icon';
import { haptic } from './overlay';

const ACCENTS: [Accent, string][] = [
  ['emerald', '#047857'], ['ocean', '#0a63d4'], ['royal', '#6d28d9'], ['sunset', '#c2410c'], ['rose', '#be123c'], ['graphite', '#1f2937'],
];
const MODES = [['light', 'sun'], ['dark', 'moon'], ['auto', 'auto']] as const;
const SIZES: [TextSize, string][] = [['normal', 'A'], ['large', 'A+'], ['xl', 'A++']];

export function AppearancePanel() {
  const { t } = useTranslation();
  const { device, setDevice } = useApp();
  const set = (p: Parameters<typeof setDevice>[0]) => { haptic(8); setDevice(p); };
  return (
    <div className="stack appearance" data-testid="appearance">
      <div className="field-label">{t('look.mode')}</div>
      <div className="mode-pick" role="radiogroup" aria-label={t('look.mode')}>
        {MODES.map(([k, icon]) => (
          <button key={k} type="button" role="radio" aria-checked={device.theme === k} className={device.theme === k ? 'on' : ''} onClick={() => set({ theme: k })}>
            <span className={`mode-preview ${k}`} aria-hidden="true"><i /><i /><i /></span>
            <span className="mode-name"><Icon name={icon} size={16} /> {t(`settings.${k}`)}</span>
          </button>
        ))}
      </div>

      <div className="field-label">{t('look.accent')}</div>
      <div className="accent-pick" role="radiogroup" aria-label={t('look.accent')}>
        {ACCENTS.map(([k, color]) => (
          <button key={k} type="button" role="radio" aria-checked={device.accent === k} aria-label={t(`look.${k}`)} className={device.accent === k ? 'on' : ''}
            style={{ '--swatch': color } as React.CSSProperties} onClick={() => set({ accent: k })} data-accent-option={k}>
            <span className="swatch">{device.accent === k && <Icon name="check" size={18} strokeWidth={3} />}</span>
            <span className="accent-name">{t(`look.${k}`)}</span>
          </button>
        ))}
      </div>

      <div className="field-label">{t('look.text')}</div>
      <div className="seg" role="radiogroup" aria-label={t('look.text')}>
        {SIZES.map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={device.text === k} className={device.text === k ? 'on' : ''} onClick={() => set({ text: k })}
            aria-label={t(`look.${k}`)} style={{ fontSize: k === 'normal' ? 15 : k === 'large' ? 17 : 19 }}>{label}</button>
        ))}
      </div>
      <div className="look-sample">
        <span className="btn primary sm" aria-hidden="true"><Icon name="plus" size={16} /> {t('home.sale')}</span>
        <span className="small muted">{t('look.sample')}</span>
      </div>
    </div>
  );
}
