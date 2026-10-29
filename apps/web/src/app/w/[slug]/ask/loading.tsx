import { PageSkeleton } from '@/components/shell/skeleton';
import { getT } from '@/lib/i18n';

export default async function Loading() {
  const t = await getT();
  return <PageSkeleton label={t('Loading Ask')} />;
}
