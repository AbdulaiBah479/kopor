// Copyright and trademark notice shown in the app (More, Settings, Welcome, legal pages). See LICENSE.
import { Link } from 'react-router-dom';

export const OWNER = 'Abdulai Bah';
const FIRST = 2026;
const NOW = new Date().getFullYear();
export const COPYRIGHT = `© ${NOW > FIRST ? `${FIRST}–${NOW}` : FIRST} ${OWNER}. All rights reserved. Kopor™ is a trademark of ${OWNER}.`;

export function Copyright() {
  return (
    <div className="small muted" style={{ textAlign: 'center', fontSize: 12 }} data-testid="copyright">
      {COPYRIGHT}{' '}
      <Link to="/legal/terms">Terms</Link> · <a href={`${import.meta.env.BASE_URL}licenses.txt`} target="_blank" rel="noopener noreferrer">Open-source licences</a>
    </div>
  );
}
