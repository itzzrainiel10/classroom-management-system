import Ionicons from '@expo/vector-icons/Ionicons';

import { Button, Caption, Card, Row } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useOutbox } from '@/lib/outbox';

/** Shows changes saved on the phone that haven't reached the server yet. */
export function UploadStatus() {
  const { pending, flushing, flush } = useOutbox();
  if (!pending) return null;
  return (
    <Card tone="gold" style={{ paddingVertical: 12 }}>
      <Row>
        <Ionicons name="cloud-upload-outline" size={20} color={colors.text} />
        <Caption style={{ flex: 1, color: colors.text }}>
          {pending} change{pending === 1 ? '' : 's'} saved on this phone — will upload when you’re online.
        </Caption>
        <Button title="Retry" small variant="secondary" loading={flushing} onPress={flush} />
      </Row>
    </Card>
  );
}
