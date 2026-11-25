import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { ClassPicker, TimeField } from '@/components/pickers';
import { Button, Caption, Field, Label, Loading, Row, Screen, Segmented } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useClasses } from '@/hooks/use-classes';
import { scheduleOp } from '@/lib/data';
import { timeToMinutes } from '@/lib/format';
import { useOutbox } from '@/lib/outbox';

const DAY_OPTS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
];

export default function NewSchedule() {
  const params = useLocalSearchParams<{ classId?: string }>();
  const { data: classes } = useClasses();
  const { save } = useOutbox();
  const [classId, setClassId] = useState<string | null>(params.classId ?? null);
  const [day, setDay] = useState(1);
  const [start, setStart] = useState('09:00:00');
  const [end, setEnd] = useState('10:30:00');
  const [room, setRoom] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!classId && classes?.length === 1 && classes[0]) setClassId(classes[0].id);
  }, [classes, classId]);

  const submit = async () => {
    if (!classId) return setError('Choose a class.');
    if (timeToMinutes(end) <= timeToMinutes(start)) return setError('End time must be after the start time.');
    const o = scheduleOp(classId, { day_of_week: day, start_time: start, end_time: end, room });
    await save(o.op, o.label);
    router.back();
  };

  return (
    <Screen footer={<Button title="Save schedule" icon="checkmark" onPress={submit} />}>
      <Caption>Days, times & sections. Add one time slot at a time (e.g. Monday, then Wednesday).</Caption>
      {classes ? <ClassPicker classes={classes} value={classId} onChange={setClassId} /> : <Loading />}
      <Label>Day</Label>
      <Segmented options={DAY_OPTS} value={day} onChange={setDay} />
      <Row style={{ gap: 10 }}>
        <TimeField label="Start" value={start} onChange={setStart} />
        <TimeField label="End" value={end} onChange={setEnd} />
      </Row>
      <Field label="Room" value={room} onChangeText={setRoom} placeholder="Optional, e.g. CL 3" />
      {error ? <Caption style={{ color: colors.danger }}>{error}</Caption> : null}
    </Screen>
  );
}
