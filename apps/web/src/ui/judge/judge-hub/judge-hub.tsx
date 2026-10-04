import type { JudgeRating } from '../../../features/judge/rating';
import type { JudgeResource } from '../../../features/judge/resources';
import { hubResources } from '../../../features/judge/resources';
import { PageHeader } from '../../components/page-header/page-header';
import { RatingCard } from '../rating-card/rating-card';
import { ResourceList } from '../resource-list/resource-list';
import { StartJudging } from '../start-judging/start-judging';

export type JudgeHubProps = {
  readonly rating: JudgeRating;
  readonly resources: readonly JudgeResource[];
};

/** Judge: click to judge, your rating, and the resources to judge well. */
export function JudgeHub({ rating, resources }: JudgeHubProps) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <PageHeader title="Judge" />
      <StartJudging />
      <div className="grid grid-cols-12 items-start gap-6 max-compact:grid-cols-1 max-compact:gap-4">
        <div className="col-span-7 max-compact:col-span-1">
          <RatingCard rating={rating} />
        </div>
        <div className="col-span-5 max-compact:col-span-1">
          <ResourceList resources={hubResources(resources)} />
        </div>
      </div>
    </div>
  );
}
