import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from './common/Button';

interface SshConfigBlockProps {
  config: string;
}

export function SshConfigBlock({ config }: SshConfigBlockProps): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(config);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available in all webview contexts
    }
  };

  return (
    <div className="ssh-config">
      <pre>{config}</pre>
      <Button variant="secondary" size="sm" onClick={handleCopy}>
        {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy SSH Config</>}
      </Button>
    </div>
  );
}
