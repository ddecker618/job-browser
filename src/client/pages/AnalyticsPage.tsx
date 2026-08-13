import { useQuery } from '@tanstack/react-query';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';

import { api } from '../api.js';
import { PageHeader } from '../components/PageHeader.js';
import { EmptyState, ErrorState, LoadingState } from '../components/States.js';

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
);
const colors = [
  '#65d6ad',
  '#7ba7ff',
  '#ffb86b',
  '#c58cff',
  '#ff778c',
  '#4cc9f0',
];
const options = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#aeb8c7' } } },
  scales: {
    x: { ticks: { color: '#8f9bad' }, grid: { color: '#202936' } },
    y: { ticks: { color: '#8f9bad' }, grid: { color: '#202936' } },
  },
} as const;

export function AnalyticsPage() {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, now.getUTCDate()),
  ).toISOString();
  const end = now.toISOString();
  const analytics = useQuery({
    queryKey: ['analytics'],
    queryFn: api.analytics,
  });
  const outcomes = useQuery({
    queryKey: ['application-outcomes', start, end],
    queryFn: () => api.outcomeAnalytics(start, end),
  });
  if (analytics.isPending)
    return <LoadingState label="Loading market analytics" />;
  if (analytics.isError)
    return <ErrorState error={analytics.error} title="Analytics unavailable" />;
  const data = analytics.data;
  if (data.topEmployers.length === 0)
    return (
      <EmptyState title="No analytics yet">
        Run discovery and analysis to generate market signals.
      </EmptyState>
    );
  return (
    <>
      <PageHeader
        eyebrow="Market intelligence"
        title="Analytics"
        description="Understand demand patterns across your local opportunity set."
      />
      <div className="analytics-kpis">
        <article>
          <span>Average listed salary</span>
          <strong>
            {data.averageSalary === 0
              ? 'Not listed'
              : `$${Math.round(data.averageSalary).toLocaleString()}`}
          </strong>
        </article>
        <article>
          <span>Tracked employers</span>
          <strong>{data.topEmployers.length}</strong>
        </article>
        <article>
          <span>Skill signals</span>
          <strong>{data.topSkills.length}</strong>
        </article>
      </div>
      {outcomes.data !== undefined ? (
        <section className="panel">
          <h3>Application outcomes</h3>
          <p>
            {outcomes.data.definition} · {outcomes.data.applications.cohortSize}{' '}
            Applications · last 12 months
          </p>
          <div className="analytics-kpis">
            {outcomes.data.applications.everReached
              .slice(0, 4)
              .map((metric) => (
                <article key={metric.key}>
                  <span>Ever reached {metric.label}</span>
                  <strong>
                    {metric.rate === null
                      ? 'No sample'
                      : `${String(Math.round(metric.rate * 100))}%`}
                  </strong>
                  <small>
                    {metric.numerator}/{metric.denominator}
                    {metric.smallSample ? ' · small sample' : ''}
                  </small>
                </article>
              ))}
          </div>
          <p>
            Unknown Company: {outcomes.data.unknownCompanyCount} · Unknown
            qualifications: {outcomes.data.unknownQualificationCount}
          </p>
        </section>
      ) : null}
      <section className="chart-grid">
        <ChartPanel title="Top requested skills">
          <Bar data={chartData(data.topSkills, 'Jobs')} options={options} />
        </ChartPanel>
        <ChartPanel title="Top certifications">
          <Bar
            data={chartData(data.topCertifications, 'Jobs', '#7ba7ff')}
            options={options}
          />
        </ChartPanel>
        <ChartPanel title="Recommendation distribution">
          <Doughnut
            data={{
              labels: data.recommendationDistribution.map((item) => item.label),
              datasets: [
                {
                  data: data.recommendationDistribution.map(
                    (item) => item.value,
                  ),
                  backgroundColor: colors,
                },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: options.plugins,
            }}
          />
        </ChartPanel>
        <ChartPanel title="Jobs by score">
          <Bar
            data={chartData(data.jobsByScore, 'Jobs', '#ffb86b')}
            options={options}
          />
        </ChartPanel>
        <ChartPanel title="New jobs over time" wide>
          <Line
            data={chartData(data.jobsOverTime, 'New jobs', '#65d6ad')}
            options={options}
          />
        </ChartPanel>
        <ChartPanel title="Most active employers" wide>
          <Bar
            data={chartData(data.topEmployers, 'Jobs', '#c58cff')}
            options={options}
          />
        </ChartPanel>
      </section>
    </>
  );
}
function chartData(
  items: { label: string; value: number }[],
  label: string,
  color = '#65d6ad',
) {
  return {
    labels: items.map((item) => item.label),
    datasets: [
      {
        label,
        data: items.map((item) => item.value),
        backgroundColor: color,
        borderColor: color,
        borderWidth: 1,
      },
    ],
  };
}
function ChartPanel({
  title,
  children,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <article className={`panel chart-panel${wide ? ' chart-wide' : ''}`}>
      <h3>{title}</h3>
      <div>{children}</div>
    </article>
  );
}
