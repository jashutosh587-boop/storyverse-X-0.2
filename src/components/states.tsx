import type { ReactNode } from 'react';

/** Shown instead of a page when the database settings are missing. Lists what to set; never echoes values. */
export function SetupRequired({ problems }: { problems: string[] }) {
  return (
    <div className="shell py-16">
      <div className="panel max-w-2xl">
        <h1 className="display text-4xl">This site is not connected to a database yet</h1>
        <p className="mt-3 text-muted">
          Storyverse X reads its catalog from Supabase. These settings are missing or invalid, so there is nothing to show:
        </p>
        <ul className="mt-4 list-disc space-y-1 pl-5">
          {problems.map((problem) => (
            <li key={problem}>
              <code className="text-violet-soft">{problem}</code>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">
          Site owner: copy <code>.env.example</code> to <code>.env.local</code>, fill in your Supabase project&apos;s URL and anon key,
          and restart. <code>docs/DEPLOYMENT.md</code> has the full steps.
        </p>
      </div>
    </div>
  );
}

/** An empty list that says why it is empty and what to do about it. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="panel max-w-2xl">
      <h2 className="display text-3xl">{title}</h2>
      {children ? <div className="mt-2 space-y-2 text-muted">{children}</div> : null}
    </div>
  );
}
