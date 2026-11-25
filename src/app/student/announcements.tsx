import { Body, Caption, Card, Empty, H2, Label, Loading, OfflineNote, Screen } from '@/components/ui';
import { useStudentHome } from '@/hooks/use-student';
import { fmtDate } from '@/lib/format';

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
        <Card key={a.id} style={{ gap: 6 }}>
          <Label>Class update · {a.class?.code}</Label>
          <H2>{a.title}</H2>
          <Body>{a.message}</Body>
          <Caption>Instructor · {fmtDate(a.created_at)}</Caption>
        </Card>
      ))}
    </Screen>
  );
}
