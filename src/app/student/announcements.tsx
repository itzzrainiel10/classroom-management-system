import { AnnouncementCard } from '@/components/announcement-card';
import { Caption, Empty, Loading, OfflineNote, Screen } from '@/components/ui';
import { useStudentHome } from '@/hooks/use-student';

export default function StudentAnnouncements() {
  const { data, loading, offline, savedAt, refresh } = useStudentHome();
  const list = data?.feed.announcements ?? [];
  return (
    <Screen onRefresh={refresh}>
      <Caption>The latest from your instructor.</Caption>
      <OfflineNote show={offline} savedAt={savedAt} />
      {loading && !data ? <Loading /> : null}
      {data && !list.length ? <Empty icon="megaphone-outline" title="No announcements" body="Updates from your classes appear here." /> : null}
      {list.map((a) => (
        <AnnouncementCard
          key={a.id}
          a={a}
          classLabel={a.class ? [a.class.code, a.class.section].filter(Boolean).join(' · ') : undefined}
        />
      ))}
    </Screen>
  );
}
