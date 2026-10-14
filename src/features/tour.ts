// First-use guided tour with driver.js. Loaded on demand; shown once per device.
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { setMeta } from '@/db/repo';

export function startTour(t: (k: string) => string) {
  const step = (sel: string, key: string) => ({ element: sel, popover: { title: t(`tour.${key}Title`), description: t(`tour.${key}`) } });
  const d = driver({
    showProgress: true,
    nextBtnText: t('tour.next'), prevBtnText: t('tour.prev'), doneBtnText: t('tour.done'), progressText: '{{current}} / {{total}}',
    steps: [
      { popover: { title: t('tour.welcomeTitle'), description: t('tour.welcome') } },
      step('[data-tour="hero"]', 'profit'),
      step('[data-tour="quick"]', 'quick'),
      step('[data-tour="speak"]', 'speak'),
      step('[data-tour="insights"]', 'insights'),
      step('.nav', 'nav'),
    ].filter((s) => !('element' in s) || document.querySelector(s.element as string)),
    onDestroyed: () => { setMeta('tourDone', true); },
  });
  d.drive();
}
