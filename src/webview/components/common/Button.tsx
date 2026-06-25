import React from 'react';

// Shared Button per @orchard-cde/design components/button.md.
// webview has no component framework, so this thin wrapper over
// .btn CSS classes (the no-framework equivalent of orchard-ui's Button.tsx).
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps): React.ReactElement {
  const classes = ['btn', `btn--${variant}`, `btn--${size}`];
  if (className) { classes.push(className); }
  return (
    <button className={classes.join(' ')} disabled={disabled || loading} {...rest}>
      {loading && <span className="btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
