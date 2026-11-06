'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

/** A submit button that disables itself and shows `pendingLabel` while its form is being sent. */
export function SubmitButton({
  children,
  pendingLabel,
  className = 'btn btn-primary',
}: {
  children: ReactNode;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}
