import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Props = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, Props>(({ className, ...rest }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm',
      'focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500',
      'disabled:bg-gray-100',
      className,
    )}
    {...rest}
  />
));
Input.displayName = 'Input';
