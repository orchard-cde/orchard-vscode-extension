import React, { useState } from 'react';

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
      <button className="btn" onClick={handleCopy}>
        {copied ? '✓ Copied' : 'Copy SSH Config'}
      </button>
    </div>
  );
}
