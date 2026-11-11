import { useState } from 'react';
import { Icon } from '../../shared/icons/icon';

export function ConnectorIcon({ iconUrl }: { iconUrl?: string | null }) {
  const [failed, setFailed] = useState<string>();
  return <div className="connector-card-icon" aria-hidden="true">
    {iconUrl && iconUrl !== failed
      ? <img src={iconUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(iconUrl)} />
      : <Icon className="connector-line-icon" name="plugin" />}
  </div>;
}
