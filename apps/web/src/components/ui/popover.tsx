import * as React from 'react';
import * as Primitive from '@radix-ui/react-popover';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export const PopoverAnchor = Primitive.Anchor;
export const PopoverContent = React.forwardRef<React.ElementRef<typeof Primitive.Content>,React.ComponentPropsWithoutRef<typeof Primitive.Content>>(({className,align='start',sideOffset=4,...props},ref)=>{
  const {i18n}=useTranslation();
  return <Primitive.Portal><Primitive.Content ref={ref} dir={i18n?.language?.startsWith('ar')?'rtl':'ltr'} align={align} sideOffset={sideOffset} collisionPadding={8} className={cn('z-50 max-w-[calc(100vw-2rem)] rounded-md border bg-popover text-popover-foreground shadow-xs outline-hidden',className)} {...props}/></Primitive.Portal>;
});
PopoverContent.displayName='PopoverContent';
