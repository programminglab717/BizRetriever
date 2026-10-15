import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-muted/40 px-4 py-10">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        BizRetriever
      </Link>
      <main className="w-full max-w-md">{children}</main>
    </div>
  );
}
