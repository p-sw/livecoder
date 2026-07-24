import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Badge({ className, children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] leading-none tracking-[0.07em] uppercase border border-border rounded-full text-muted bg-[rgba(255,255,255,0.025)]',
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
