import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-medium text-muted-foreground">BizRetriever</p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Your business, explained.
      </h1>
      <p className="text-lg text-muted-foreground">
        Upload the spreadsheets you already have, messy is fine. Get clear answers, a dashboard
        built for your shop, and a heads-up when something needs your attention.
      </p>
      <div>
        <Button size="lg" disabled>
          Getting ready. Sign-up opens soon
        </Button>
      </div>
    </main>
  );
}
