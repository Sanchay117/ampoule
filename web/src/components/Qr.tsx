// SPDX-License-Identifier: Apache-2.0
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** A QR code of a token string, as the phone or the counter screen would show it. */
export function Qr({ value, caption }: { value: string; caption?: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, { margin: 1, width: 336, errorCorrectionLevel: 'M', color: { dark: '#12201b', light: '#ffffff' } })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(undefined));
    return () => {
      live = false;
    };
  }, [value]);
  return (
    <div className="qr">
      {src ? <img src={src} alt={caption ?? 'QR code'} data-token={value} /> : <div style={{ width: 168, height: 168 }} />}
      {caption && <span>{caption}</span>}
    </div>
  );
}
