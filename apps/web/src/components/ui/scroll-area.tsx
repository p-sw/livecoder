import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export const ScrollArea = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('ui-scroll-area', className)} {...props} />,
);
ScrollArea.displayName = 'ScrollArea';
