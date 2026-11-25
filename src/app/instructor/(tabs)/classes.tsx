import { router } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader, Button, Caption, Card, Empty, H2, Loading, OfflineNote, Pill, Row, Screen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useClasses } from '@/hooks/use-classes';
import { Pressable } from 'react-native';

export default function InstructorClasses() {
  const { data, loading, offline, savedAt, refresh, error } = useClasses();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <Screen onRefresh={refresh}>
        <AppHeader crumb="Instructor" title="Manage Classes" subtitle="Students, activities & settings" />
        <OfflineNote show={offline} savedAt={savedAt} />
        <Button title="New class" icon="add" onPress={() => router.push('/instructor/class/new')} />
        {loading && !data ? <Loading /> : null}
        {error ? <Caption style={{ color: colors.danger }}>{error}</Caption> : null}
        {data && data.length === 0 ? (
          <Empty icon="people-outline" title="No classes yet" body="Create a class like “ITEC 116 · Web Development · Dash 3”, then add students by their CvSU email." />
        ) : null}
        {data?.map((c) => (
          <Pressable key={c.id} onPress={() => router.push(`/instructor/class/${c.id}`)} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
            <Card style={{ gap: 8 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <H2>
                    {c.code} · {c.section}
                  </H2>
                  <Caption>{c.title}</Caption>
                </View>
                {c._pending ? <Pill label="Waiting to upload" tone="gold" /> : null}
              </Row>
              <Row style={{ gap: 16 }}>
                <Caption>{c.students} students</Caption>
                <Caption>{c.quizzes} quizzes</Caption>
                <Caption>{c.assignments} assignments</Caption>
              </Row>
            </Card>
          </Pressable>
        ))}
      </Screen>
    </SafeAreaView>
  );
}
