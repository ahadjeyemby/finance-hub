import type { IconName } from '@/components/icons';

export type ViewId = 'overview' | 'household' | 'business' | 'plan';
export const VIEW_IDS: ViewId[] = ['overview', 'household', 'business', 'plan'];

export interface ViewDef {
  id: ViewId;
  label: string;
  icon: IconName;
  /** the line under the tabs that says what the view is for */
  blurb: string;
  /** whose spending the view counts: Overview everything, Household and Plan ahead personal only, Business business only */
  scope: 'all' | 'personal' | 'business';
}

export const VIEWS: Record<ViewId, ViewDef> = {
  overview: { id: 'overview', label: 'Overview', icon: 'overview', scope: 'all', blurb: 'The whole picture: what came in, what went out, and what needs a look.' },
  household: { id: 'household', label: 'Household', icon: 'home', scope: 'personal', blurb: 'Where the household money goes, and where it could go further.' },
  business: { id: 'business', label: 'Business', icon: 'brief', scope: 'business', blurb: 'Business spending kept apart from home. Your answers in the inbox decide what counts.' },
  plan: { id: 'plan', label: 'Plan ahead', icon: 'trend', scope: 'personal', blurb: 'What the coming months will likely cost, built from what repeats.' },
};

export const isViewId = (v: unknown): v is ViewId => typeof v === 'string' && (VIEW_IDS as string[]).includes(v);
