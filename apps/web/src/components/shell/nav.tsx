'use client';

import {
  BookOpen,
  Bell,
  CalendarRange,
  Home,
  LayoutDashboard,
  Menu,
  MessageCircleQuestion,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import { msg } from '@bizr/i18n/translate';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useT } from '@/components/i18n/provider';
import { cn } from '@/lib/utils';

type Segment =
  'home' | 'ask' | 'dashboard' | 'data' | 'more' | 'settings' | 'glossary' | 'insights' | 'plan';

interface NavItem {
  segment: Segment;
  label: string;
  icon: LucideIcon;
}

const ITEMS: NavItem[] = [
  { segment: 'home', label: msg('Home'), icon: Home },
  { segment: 'ask', label: msg('Ask'), icon: MessageCircleQuestion },
  { segment: 'dashboard', label: msg('Dashboard'), icon: LayoutDashboard },
  { segment: 'data', label: msg('My data'), icon: Table2 },
];
const MORE: NavItem = { segment: 'more', label: msg('More'), icon: Menu };

function useActiveSegment(slug: string): string | undefined {
  const pathname = usePathname();
  const rest = pathname.slice(`/w/${slug}/`.length);
  const segment = rest.split('/')[0];
  return segment;
}

/** Left sidebar, shown from the `md` breakpoint up. */
export function SidebarNav({ slug }: { slug: string }) {
  const t = useT();
  const active = useActiveSegment(slug);
  return (
    <nav aria-label={t('Main')} className="grid gap-1">
      {[
        ...ITEMS,
        { label: msg('Insights'), segment: 'insights' as const, icon: Bell },
        { label: msg('Plan ahead'), segment: 'plan' as const, icon: CalendarRange },
        { label: msg('What we track'), segment: 'glossary' as const, icon: BookOpen },
        { ...MORE, label: msg('Settings'), segment: 'settings' as const },
      ].map((item) => {
        const isActive =
          active === item.segment || (item.segment === 'settings' && active === 'more');
        return (
          <Link
            key={item.segment}
            href={`/w/${slug}/${item.segment}`}
            // i18n-skip: an ARIA value
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground',
              isActive && 'bg-accent text-foreground',
            )}
          >
            <item.icon className="size-4" aria-hidden />
            {t(item.label)}
          </Link>
        );
      })}
    </nav>
  );
}

/** Bottom tab bar for phones (below `md`). */
export function BottomNav({ slug }: { slug: string }) {
  const t = useT();
  const segment = useActiveSegment(slug);
  const active =
    segment === 'settings' || segment === 'glossary' || segment === 'plan' ? 'more' : segment;
  return (
    <nav
      aria-label={t('Main')}
      className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-5">
        {[...ITEMS, MORE].map((item) => {
          const isActive = active === item.segment;
          return (
            <li key={item.segment}>
              <Link
                href={`/w/${slug}/${item.segment}`}
                // i18n-skip: an ARIA value
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 text-xs text-muted-foreground',
                  isActive && 'text-foreground',
                )}
              >
                <item.icon className="size-5" aria-hidden />
                {t(item.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
