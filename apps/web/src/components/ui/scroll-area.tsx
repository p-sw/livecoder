// ponytail: shadcn-style scrollable area with a forwardRef so parent
// components can attach scroll listeners. The dark scrollbar rules
// live in styles.css (`.ui-scroll-area`) because Tailwind has no
// built-in scrollbar-color utility that matches the design.

import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export const ScrollArea = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function ScrollArea(
  { className, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={cn('min-h-0 flex-1 overflow-auto ui-scroll-area', className)} {...rest}>
      {children}
    </div>
  );
});
