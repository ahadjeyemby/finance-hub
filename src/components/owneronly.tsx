import { router } from 'expo-router';
import type { ComponentType } from 'react';

import { ScreenHeader } from '@/components/header';
import { useRepo } from '@/data/repo';
import { Button, Card, Screen, T } from '@/theme/ui';

/**
 * A page kept for the person who runs the workspace. A Contributor (migration 0010) reaching it by its address sees a plain note that says
 * nothing about what the page holds; the data behind it never reaches their device anyway.
 */
export function ownerOnly<P extends object>(Page: ComponentType<P>): ComponentType<P> {
  return function OwnerOnlyPage(props: P) {
    const { spendingOnly } = useRepo();
    if (!spendingOnly) return <Page {...props} />;
    return (
      <Screen max={760}>
        <ScreenHeader back title="Not available" sub="This page is for the person who runs this workspace." />
        <Card>
          <T size={14}>You can add receipts and credit card statements, and sort the spending you see.</T>
          <Button label="Go to the dashboard" onPress={() => router.navigate('/')} />
        </Card>
      </Screen>
    );
  };
}
