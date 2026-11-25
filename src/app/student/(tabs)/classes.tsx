import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader, Caption, Card, Empty, H2, Label, Loading, OfflineNote, Row, Screen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useStudentHome } from '@/hooks/use-student';
import { useAuth } from '@/lib/auth';

export default function StudentClasses() {
  const { email } = useAuth();
  const { data, loading, offline, savedAt, refresh } = useStudentHome();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <Screen onRefresh={refresh}>
        <AppHeader crumb="Student" title="My Classes" subtitle="Your learning, all in one place." />
        <OfflineNote show={offline} savedAt={savedAt} />
        {loading && !data ? <Loading /> : null}
        {data && data.classes.length === 0 ? (
          <Empty icon="book-outline" title="No classes yet" body={`Ask your instructor to add ${email ?? 'your email'} to their class. It will show up here.`} />
        ) : null}
        {data?.classes.map((c) => {
          const quizzes = data.quizzes.filter((q) => q.class_id === c.id);
          return (
            <Pressable key={c.id} onPress={() => router.push(`/student/class/${c.id}`)} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
              <Card style={{ gap: 8 }}>
                <Label>My class</Label>
                <View>
                  <H2>{c.code}</H2>
                  <Caption>
                    {c.title} · Section {c.section}
                  </Caption>
                </View>
                <Row style={{ gap: 16 }}>
                  <Caption>{quizzes.length} quizzes</Caption>
                  <Caption>{data.feed.assignments.filter((a) => a.class_id === c.id).length} assignments</Caption>
                </Row>
              </Card>
            </Pressable>
          );
        })}
      </Screen>
    </SafeAreaView>
  );
}
