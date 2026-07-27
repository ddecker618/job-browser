import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api.js';
import { PageHeader } from '../components/PageHeader.js';
import { ErrorState, LoadingState } from '../components/States.js';
import type { CandidateProfile } from '../../schemas/candidate-profile.js';
import type { ScoringConfig } from '../../schemas/scoring-config.js';

interface ProfileForm {
  name: string;
  preferredTitles: string;
  excludedTitles: string;
  locations: string;
  searchRadiusMiles: number;
  secondarySearchRadiusMiles: number;
  remotePreference: CandidateProfile['remotePreference'];
  salaryMinimum: string;
  salaryTarget: string;
  skills: string;
  certifications: string;
  yearsOfExperience: string;
  education: string;
  titleWeight: number;
  skillsWeight: number;
  certificationsWeight: number;
  locationWeight: number;
  remoteWeight: number;
  salaryWeight: number;
  experienceWeight: number;
  employmentWeight: number;
  recencyWeight: number;
}

export function ProfilePage() {
  const data = useQuery({ queryKey: ['profile'], queryFn: api.profile });
  const client = useQueryClient();
  const form = useForm<ProfileForm>();
  useEffect(() => {
    if (data.data !== undefined)
      form.reset(toForm(data.data.profile, data.data.scoring));
  }, [data.data, form]);
  const save = useMutation({
    mutationFn: async ({
      values,
      rescore,
    }: {
      values: ProfileForm;
      rescore: boolean;
    }) => {
      if (data.data === undefined) throw new Error('Profile is not loaded');
      const profile = fromForm(values, data.data.profile);
      const scoring = scoringFromForm(values, data.data.scoring);
      await api.saveScoring(scoring);
      return api.saveProfile(profile, rescore);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['profile'] }),
  });

  if (data.isPending) return <LoadingState label="Loading candidate profile" />;
  if (data.isError)
    return <ErrorState error={data.error} title="Candidate profile missing" />;

  return (
    <>
      <PageHeader
        eyebrow="Candidate intelligence"
        title="Profile & scoring"
        description="Tune what a strong opportunity means. Changes stay local and can immediately re-score every job."
      />
      <form
        className="profile-form"
        onSubmit={(event) =>
          void form.handleSubmit((values) =>
            save.mutate({ values, rescore: false }),
          )(event)
        }
      >
        <section className="form-panel">
          <div className="section-heading">
            <span>01</span>
            <div>
              <h3>Search intent</h3>
              <p>Titles, locations, and working preferences.</p>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Profile name
              <input {...form.register('name', { required: true })} />
            </label>
            <label>
              Remote preference
              <select {...form.register('remotePreference')}>
                <option value="preferred">Preferred</option>
                <option value="accepted">Accepted</option>
                <option value="not-preferred">Not preferred</option>
              </select>
            </label>
            <label className="span-2">
              Preferred titles
              <textarea
                {...form.register('preferredTitles')}
                placeholder="One title per line"
              />
            </label>
            <label className="span-2">
              Excluded titles
              <textarea
                {...form.register('excludedTitles')}
                placeholder="One title per line"
              />
            </label>
            <label className="span-2">
              Preferred locations
              <textarea
                {...form.register('locations')}
                placeholder="City, State"
              />
            </label>
            <label>
              Primary radius
              <input
                type="number"
                {...form.register('searchRadiusMiles', { valueAsNumber: true })}
              />
            </label>
            <label>
              Secondary radius
              <input
                type="number"
                {...form.register('secondarySearchRadiusMiles', {
                  valueAsNumber: true,
                })}
              />
            </label>
          </div>
        </section>
        <section className="form-panel">
          <div className="section-heading">
            <span>02</span>
            <div>
              <h3>Qualifications</h3>
              <p>Skills, credentials, education, and experience.</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="span-2">
              Skills
              <textarea {...form.register('skills')} />
            </label>
            <label className="span-2">
              Certifications
              <textarea {...form.register('certifications')} />
            </label>
            <label className="span-2">
              Education
              <textarea
                {...form.register('education')}
                placeholder="Degree | Institution | Status | YYYY-MM"
              />
            </label>
            <label>
              Years of experience
              <input
                type="number"
                step="0.5"
                {...form.register('yearsOfExperience')}
              />
            </label>
            <label>
              Desired salary minimum
              <input type="number" {...form.register('salaryMinimum')} />
            </label>
            <label>
              Desired salary target
              <input type="number" {...form.register('salaryTarget')} />
            </label>
          </div>
        </section>
        <section className="form-panel">
          <div className="section-heading">
            <span>03</span>
            <div>
              <h3>Scoring preferences</h3>
              <p>Weights must total 100 points.</p>
            </div>
          </div>
          <div className="weight-grid">
            {weightFields.map(([field, label]) => (
              <label key={field}>
                {label}
                <input
                  type="number"
                  min="0"
                  max="100"
                  {...form.register(field, { valueAsNumber: true })}
                />
              </label>
            ))}
          </div>
        </section>
        <div className="sticky-form-actions">
          <span>
            {save.isSuccess
              ? 'Profile saved.'
              : save.isError
                ? save.error.message
                : 'Changes are validated before saving.'}
          </span>
          <button
            type="button"
            className="button"
            onClick={(event) =>
              void form.handleSubmit((values) =>
                save.mutate({ values, rescore: true }),
              )(event)
            }
          >
            Save & re-score all
          </button>
          <button className="button primary" type="submit">
            Save profile
          </button>
        </div>
      </form>
    </>
  );
}

const weightFields = [
  ['titleWeight', 'Title'],
  ['skillsWeight', 'Skills'],
  ['certificationsWeight', 'Certifications'],
  ['locationWeight', 'Location'],
  ['remoteWeight', 'Remote'],
  ['salaryWeight', 'Salary'],
  ['experienceWeight', 'Experience'],
  ['employmentWeight', 'Employment'],
  ['recencyWeight', 'Recency'],
] as const;
function lines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}
function toForm(
  profile: CandidateProfile,
  scoring: ScoringConfig,
): ProfileForm {
  return {
    name: profile.name,
    preferredTitles: profile.desiredJobTitles.join('\n'),
    excludedTitles: profile.excludedJobTitles.join('\n'),
    locations: profile.preferredLocations
      .map((location) => `${location.city}, ${location.state}`)
      .join('\n'),
    searchRadiusMiles: profile.searchRadiusMiles,
    secondarySearchRadiusMiles: profile.secondarySearchRadiusMiles,
    remotePreference: profile.remotePreference,
    salaryMinimum: profile.desiredSalary?.minimum.toString() ?? '',
    salaryTarget: profile.desiredSalary?.target.toString() ?? '',
    skills: profile.skills.join('\n'),
    certifications: profile.certifications.join('\n'),
    yearsOfExperience: profile.yearsOfExperience?.toString() ?? '',
    education: profile.degrees
      .map(
        (degree) =>
          `${degree.name} | ${degree.institution} | ${degree.status} | ${degree.expectedCompletion ?? ''}`,
      )
      .join('\n'),
    titleWeight: scoring.weights.title,
    skillsWeight: scoring.weights.skills,
    certificationsWeight: scoring.weights.certifications,
    locationWeight: scoring.weights.location,
    remoteWeight: scoring.weights.remotePreference,
    salaryWeight: scoring.weights.salary,
    experienceWeight: scoring.weights.experience,
    employmentWeight: scoring.weights.employmentType,
    recencyWeight: scoring.weights.recency,
  };
}
function fromForm(
  values: ProfileForm,
  original: CandidateProfile,
): CandidateProfile {
  return {
    ...original,
    name: values.name,
    desiredJobTitles: lines(values.preferredTitles),
    excludedJobTitles: lines(values.excludedTitles),
    preferredLocations: lines(values.locations).map((value) => {
      const [city = value, state = ''] = value
        .split(',')
        .map((part) => part.trim());
      return { city, state: state || 'Unknown' };
    }),
    searchRadiusMiles: values.searchRadiusMiles,
    secondarySearchRadiusMiles: values.secondarySearchRadiusMiles,
    remotePreference: values.remotePreference,
    desiredSalary:
      values.salaryMinimum && values.salaryTarget
        ? {
            minimum: Number(values.salaryMinimum),
            target: Number(values.salaryTarget),
            currency: 'USD',
          }
        : null,
    skills: lines(values.skills),
    certifications: lines(values.certifications),
    yearsOfExperience: values.yearsOfExperience
      ? Number(values.yearsOfExperience)
      : null,
    degrees: lines(values.education).map((value) => {
      const [
        name = value,
        institution = 'Unknown',
        status = 'unknown',
        expected = '',
      ] = value.split('|').map((part) => part.trim());
      return {
        name,
        institution,
        status,
        expectedCompletion: expected || null,
      };
    }),
  };
}
function scoringFromForm(
  values: ProfileForm,
  original: ScoringConfig,
): ScoringConfig {
  return {
    ...original,
    weights: {
      title: values.titleWeight,
      skills: values.skillsWeight,
      certifications: values.certificationsWeight,
      location: values.locationWeight,
      remotePreference: values.remoteWeight,
      salary: values.salaryWeight,
      experience: values.experienceWeight,
      employmentType: values.employmentWeight,
      recency: values.recencyWeight,
    },
  };
}
