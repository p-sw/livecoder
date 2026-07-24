import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'w-full h-9 px-3 text-[13px] text-fg bg-bg border border-border rounded-md outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-subtle focus:border-accent/55 focus:shadow-[0_0_0_3px_rgba(141,244,189,0.08)] disabled:opacity-40 disabled:cursor-not-allowed',
        className,
      )}
      {...rest}
    />
  );
});
