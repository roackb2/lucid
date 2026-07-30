import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import {
  forwardRef,
  type ButtonHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva('button', {
  variants: {
    variant: {
      primary: 'button--primary',
      secondary: 'button--secondary',
      ghost: 'button--ghost',
      danger: 'button--danger',
    },
    size: {
      default: 'button--default',
      small: 'button--small',
      icon: 'button--icon',
    },
  },
  defaultVariants: {
    variant: 'primary',
    size: 'default',
  },
});

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>
  & VariantProps<typeof buttonVariants>
  & {
    asChild?: boolean;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, className, size, variant, ...props }, ref) => {
    const Component = asChild ? Slot : 'button';
    return (
      <Component
        className={cn(buttonVariants({ size, variant }), className)}
        ref={ref}
        {...props}
      />
    );
  },
);

Button.displayName = 'Button';
