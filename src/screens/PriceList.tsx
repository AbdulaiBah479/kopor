// Stock → share: the price list as a WhatsApp message, or as an online page with a QR code to print and stick up in
// the shop. Customers see the real prices there, so nobody can charge them more.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Icon } from '@/ui/Icon';
import { QrCode } from '@/ui/QrCode';
import { shareText } from '@/lib/share';
import { publicLink } from '@/lib/links';
import { catalogToken } from '@/cloud/catalog';

export function PriceListSheet({ text }: { text: string }) {
  const { t } = useTranslation();
  const book = useBook();
  const { can, sync } = useApp();
  const { fail, toast } = useOverlay();
  const [url, setUrl] = useState<string | null>(book.org.catalog_token ? publicLink(`/c/${book.org.catalog_token}`) : null);
  const make = async (renew = false) => {
    try { setUrl(publicLink(`/c/${await catalogToken(book.org.id, renew)}`)); if (renew) toast(t('price.renewed')); } catch (e) { fail(e); }
  };
  return (
    <div className="stack" data-testid="price-sheet">
      <button className="btn block" onClick={() => shareText(text)}><Icon name="chat" size={18} /> {t('price.shareText')}</button>
      {can('reports') && sync.status !== 'off' && (url ? (
        <div className="card flat stack" style={{ alignItems: 'center', textAlign: 'center' }} data-testid="price-online">
          <b>{t('price.online')}</b>
          <QrCode text={url} />
          <div className="small muted" style={{ wordBreak: 'break-all' }}>{url}</div>
          <div className="small">{t('price.qrHelp')}</div>
          <div className="btn-row">
            <button className="btn primary sm" onClick={() => shareText(t('price.shareMsg', { business: book.org.name, link: url }))}><Icon name="share" size={16} /> {t('common.share')}</button>
            <button className="btn ghost sm" onClick={() => make(true)}>{t('price.renew')}</button>
          </div>
        </div>
      ) : <button className="btn primary block" data-testid="price-make" onClick={() => make()}><Icon name="qr" size={18} /> {t('price.make')}</button>)}
      {can('reports') && sync.status === 'off' && <div className="small muted">{t('price.needCloud')}</div>}
    </div>
  );
}
