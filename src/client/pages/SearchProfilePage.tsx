import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { PageHeader } from '../components/PageHeader.js';
import { ErrorState, LoadingState } from '../components/States.js';
import type { SearchProfile, RoleFamily } from '../../config/search-profile.js';

export function SearchProfilePage() {
  const query = useQuery({
    queryKey: ['search-profile'],
    queryFn: api.searchProfile,
  });
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: api.saveSearchProfile,
    onSuccess: () => client.invalidateQueries({ queryKey: ['search-profile'] }),
  });
  const [draft, setDraft] = useState<SearchProfile | null>(null);
  const profile = draft ?? query.data;

  if (query.isPending) return <LoadingState label="Loading search profile" />;
  if (query.isError)
    return (
      <ErrorState error={query.error} title="Search profile unavailable" />
    );

  const toggleFamily = (key: string) => {
    if (!profile) return;
    setDraft({
      ...profile,
      families: profile.families.map((f) =>
        f.key === key ? { ...f, enabled: !f.enabled } : f,
      ),
    });
  };

  const addTitle = (familyKey: string, title: string) => {
    if (!profile) return;
    const trimmed = title.trim();
    if (!trimmed) return;
    setDraft({
      ...profile,
      families: profile.families.map((f) =>
        f.key === familyKey
          ? {
              ...f,
              titles: f.titles.includes(trimmed)
                ? f.titles
                : [...f.titles, trimmed],
            }
          : f,
      ),
    });
  };

  const removeTitle = (familyKey: string, index: number) => {
    if (!profile) return;
    setDraft({
      ...profile,
      families: profile.families.map((f) =>
        f.key === familyKey
          ? { ...f, titles: f.titles.filter((_, i) => i !== index) }
          : f,
      ),
    });
  };

  const handleSave = () => {
    if (draft) save.mutate(draft);
    setDraft(null);
  };

  const totalEnabled =
    profile?.families
      .filter((f) => f.enabled)
      .reduce((sum, f) => sum + f.titles.length, 0) ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Discovery configuration"
        title="Search Profile"
        description={`${String(totalEnabled)} job titles across ${String(profile?.families.filter((f) => f.enabled).length ?? 0)} enabled role families.`}
      />
      <div className="search-profile-page">
        <div className="profile-summary">
          <span>
            <strong>Remote-first:</strong>{' '}
            {profile?.prioritizeRemote ? 'Enabled' : 'Disabled'}
          </span>
          <span>
            <strong>Max onsite distance:</strong>{' '}
            {profile?.maxOnsiteDistanceMiles} miles
          </span>
          <span>
            <strong>Preferred location:</strong> {profile?.preferredLocation}
          </span>
          <span>
            <strong>Max experience:</strong> {profile?.maxExperienceYears} years
          </span>
          <span>
            <strong>Max queries per run:</strong> {profile?.maxQueriesPerRun}
          </span>
        </div>
        <div className="family-list">
          {profile?.families.map((family) => (
            <FamilyCard
              key={family.key}
              family={family}
              onToggle={() => toggleFamily(family.key)}
              onAddTitle={(title) => addTitle(family.key, title)}
              onRemoveTitle={(index) => removeTitle(family.key, index)}
            />
          ))}
        </div>
        <div className="sticky-form-actions">
          <span>
            {save.isSuccess
              ? 'Profile saved.'
              : 'Changes apply to future discovery runs.'}
          </span>
          <button
            className="button primary"
            onClick={handleSave}
            disabled={save.isPending || draft === null}
          >
            {save.isPending ? 'Saving...' : 'Save profile'}
          </button>
        </div>
      </div>
    </>
  );
}

function FamilyCard({
  family,
  onToggle,
  onAddTitle,
  onRemoveTitle,
}: {
  family: RoleFamily;
  onToggle: () => void;
  onAddTitle: (title: string) => void;
  onRemoveTitle: (index: number) => void;
}) {
  const [input, setInput] = useState('');
  return (
    <div className={`family-card${family.enabled ? '' : ' family-disabled'}`}>
      <div className="family-header">
        <label className="family-toggle">
          <input type="checkbox" checked={family.enabled} onChange={onToggle} />
          <strong>{family.displayName}</strong>
          <span className="family-count">{family.titles.length} titles</span>
        </label>
      </div>
      <div className="family-titles">
        {family.titles.map((title, index) => (
          <span key={title} className="role-tag">
            {title}
            {family.enabled && (
              <button
                type="button"
                className="tag-remove"
                onClick={() => onRemoveTitle(index)}
              >
                &times;
              </button>
            )}
          </span>
        ))}
      </div>
      {family.enabled && (
        <div className="family-add">
          <input
            value={input}
            placeholder="Add a title…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAddTitle(input);
                setInput('');
              }
            }}
          />
          <button
            type="button"
            className="button small"
            onClick={() => {
              onAddTitle(input);
              setInput('');
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
