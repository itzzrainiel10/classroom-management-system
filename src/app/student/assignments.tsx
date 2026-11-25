import { Body, Caption, Card, Empty, H2, Label, Loading, OfflineNote, Screen } from '@/components/ui';
import { useStudentHome } from '@/hooks/use-student';
import { fmtDate, fmtDateTime } from '@/lib/format';

export default function StudentAssignments() {
  const { data, loading, offline, savedAt, refresh } = useStudentHome();
  const list = [...(data?.feed.assignments ?? [])].sort((a, b) => (a.due_at ?? '9').localeCompare(b.due_at ?? '9'));
  return (
    <Screen onRefresh={refresh}>
      <Caption>Keep track of your coursework.</Caption>
      <OfflineNote show={offline} savedAt={savedAt} />
      {loading && !data ? <Loading /> : null}
      {data && !list.length ? <Empty icon="document-text-outline" title="No assignments" body="Assignments from your instructors appear here." /> : null}
      {list.map((a) => (
        <Card key={a.id} style={{ gap: 6 }}>
          <Label>To do · Due {fmtDate(a.due_at)}</Label>
          <H2>{a.title}</H2>
          <Caption>
            {a.class?.code} · {a.class?.title} · Section {a.class?.section}
          </Caption>
          {a.description ? <Body>{a.description}</Body> : null}
          <Caption>Due {fmtDateTime(a.due_at)}</Caption>
        </Card>
      ))}
    </Screen>
  );
}
