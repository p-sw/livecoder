// ponytail: shadcn-style button with Tailwind variants. The previous
// hand-rolled version had per-variant styles in styles.css; those
// classes no longer exist so the component was visually broken. Variants
// now map to utility strings via cn().

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type Variant = 'default' | 'secondary' | 'outline' | 'ghost';
type Size = 'default' | 'sm' | 'lg' | 'icon';

const BASE = 'inline-flex items-center justify-center gap-2 rounded-md border-0 font-medium whitespace-nowrap transition-[background,border-color,color,transform] duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none';

const VARIANTS: Record<Variant, string> = {
  default: 'bg-accent text-fg-on-accent font-bold shadow-[0_0_0_1px_rgba(141,244,189,0.12),0_8px_24px_rgba(70,221,147,0.12)] hover:bg-[#b1f8d0] hover:-translate-y-px',
  secondary: 'bg-surface-hover text-fg hover:bg-surface-hover',
  outline: 'bg-[rgba(255,255,255,0.015)] text-fg border border-border-bright hover:bg-surface-hover hover:border-[#4b6373]',
  ghost: 'bg-transparent text-muted hover:bg-surface-hover hover:text-fg',
};

const SIZES: Record<Size, string> = {
  default: 'h-9 px-3.5 text-[13px]',
  sm: 'h-7 px-2.5 text-xs',
  lg: 'h-11 px-4.5 text-sm rounded-md',
  icon: 'w-8 h-8 p-0',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'default', className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...rest}
    >
      {children}
    </button>
  );
});
