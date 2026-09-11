import type { RemoteType } from '../../domain/job.js';
import { asSegmentInputs, classifySegment } from './categorizer.js';
import { extractCertifications } from './certifications.js';
import { extractClearance } from './clearance.js';
import { extractEducation } from './education.js';
import { extractExperience } from './experience.js';
import { extractLocation } from './location.js';
import { extractSkills } from './skills.js';
import {
  SYNTHETIC_NLP_CORPUS,
  type SyntheticEntityExpectation,
  type SyntheticNlpCase,
} from './evaluationCorpus.js';
import { REPRESENTATIVE_NLP_CASES } from './representativeCorpus.js';
import { classifyStrength } from './strength.js';
import {
  type NlpEntityType,
  type NlpRequirementCategory,
  type NlpRequirementStrength,
} from '../../schemas/job-nlp.js';
import { normalizeText } from '../../utilities/normalization.js';

// ---------------------------------------------------------------------------
// Stage 17 - representative synthetic evaluation.
//
// This evaluator reports the current implementation against explicit local
// labels. It does not rewrite labels, use live job data, or promote any result
// into production scoring or eligibility.
// ---------------------------------------------------------------------------

export const NLP_EVALUATION_VERSION = 'evaluation-v1';

export const REPRESENTATIVE_NLP_CORPUS = [
  ...SYNTHETIC_NLP_CORPUS,
  ...REPRESENTATIVE_NLP_CASES,
] as const satisfies readonly SyntheticNlpCase[];

export interface CategoryEvaluationMetrics {
  expected: number;
  actual: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  exactMatches: number;
  exactAccuracy: number;
  precision: number;
  recall: number;
}

export interface StrengthEvaluationMetrics {
  total: number;
  correct: number;
  accuracy: number;
}

export interface EntityEvaluationMetrics {
  expected: number;
  actual: number;
  matched: number;
  falsePositives: number;
  falseNegatives: number;
  exactMatches: number;
  exactAccuracy: number;
  precision: number;
  recall: number;
}

export interface ArrangementEvaluationMetrics {
  labeled: number;
  exactMatches: number;
  disagreementRate: number;
}

export interface CriticalEvaluationMetrics {
  cases: number;
  failingCaseIds: string[];
  falsePositiveCount: number;
  falseNegativeCount: number;
  failureRate: number;
}

export interface NlpCaseEvaluation {
  id: string;
  kind: SyntheticNlpCase['kind'];
  actualCategories: NlpRequirementCategory[];
  expectedCategories: NlpRequirementCategory[];
  actualStrength: NlpRequirementStrength;
  expectedStrength: NlpRequirementStrength;
  actualEntities: SyntheticEntityExpectation[];
  expectedEntities: SyntheticEntityExpectation[];
  actualArrangement: RemoteType;
  expectedArrangement: RemoteType | null;
  categoryExactMatch: boolean;
  strengthCorrect: boolean;
  entityExactMatch: boolean;
  criticalFailures: string[];
}

export interface NlpEvaluationReport {
  evaluationVersion: typeof NLP_EVALUATION_VERSION;
  caseCount: number;
  caseResults: NlpCaseEvaluation[];
  categories: CategoryEvaluationMetrics;
  strengths: StrengthEvaluationMetrics;
  entities: EntityEvaluationMetrics;
  arrangements: ArrangementEvaluationMetrics;
  critical: CriticalEvaluationMetrics;
  disagreementRate: number;
}

export function evaluateSyntheticNlpCorpus(
  cases: readonly SyntheticNlpCase[] = REPRESENTATIVE_NLP_CORPUS,
): NlpEvaluationReport {
  const caseResults = cases.map((item) => evaluateSyntheticNlpCase(item));
  const categoryResults = summarizeCategories(caseResults);
  const strengthResults = summarizeStrengths(caseResults);
  const entityResults = summarizeEntities(caseResults);
  const arrangements = summarizeArrangements(caseResults);
  const critical = summarizeCritical(caseResults);
  const disagreements = caseResults.filter(
    (result) => !result.categoryExactMatch || !result.strengthCorrect,
  ).length;

  return {
    evaluationVersion: NLP_EVALUATION_VERSION,
    caseCount: caseResults.length,
    caseResults,
    categories: categoryResults,
    strengths: strengthResults,
    entities: entityResults,
    arrangements,
    critical,
    disagreementRate: rate(disagreements, caseResults.length),
  };
}

export function evaluateSyntheticNlpCase(
  item: SyntheticNlpCase,
): NlpCaseEvaluation {
  const segment = asSegmentInputs([
    { index: 0, text: item.text, kind: 'sentence' },
  ])[0];
  if (segment === undefined) {
    throw new Error(`Evaluation case ${item.id} has no segment`);
  }

  const classification = classifySegment(segment);
  const strength = classifyStrength(segment, classification.categories);
  const actualEntities = extractEntities(segment);
  const actualArrangement = extractLocation(segment).arrangement;
  const expectedCategories = [...item.expectedCategories];
  const expectedEntities = [...item.expectedEntities];
  const actualCategories = [...classification.categories];
  const expectedCategorySet = new Set(expectedCategories);
  const actualCategorySet = new Set(actualCategories);
  const categoryExactMatch = setsEqual(expectedCategorySet, actualCategorySet);
  const expectedEntitySet = new Set(expectedEntities.map(entityKey));
  const actualEntitySet = new Set(actualEntities.map(entityKey));
  const entityExactMatch = setsEqual(expectedEntitySet, actualEntitySet);
  const criticalFailures: string[] = [];

  for (const category of item.forbiddenCategories) {
    if (actualCategorySet.has(category)) {
      criticalFailures.push(`forbidden-category:${category}`);
    }
  }
  for (const entity of item.forbiddenEntities ?? []) {
    if (actualEntitySet.has(entityKey(entity))) {
      criticalFailures.push(`forbidden-entity:${entityKey(entity)}`);
    }
  }
  if (item.kind === 'adversarial') {
    if (strength.strength !== item.expectedStrength)
      criticalFailures.push('strength-mismatch');
    if (!entityExactMatch) criticalFailures.push('entity-mismatch');
    for (const category of expectedCategories) {
      if (!actualCategorySet.has(category)) {
        criticalFailures.push(`missing-category:${category}`);
      }
    }
    if (
      item.expectedArrangement !== undefined &&
      actualArrangement !== item.expectedArrangement
    ) {
      criticalFailures.push(
        `arrangement:${item.expectedArrangement}:${actualArrangement}`,
      );
    }
  }

  return {
    id: item.id,
    kind: item.kind,
    actualCategories,
    expectedCategories,
    actualStrength: strength.strength,
    expectedStrength: item.expectedStrength,
    actualEntities,
    expectedEntities,
    actualArrangement,
    expectedArrangement: item.expectedArrangement ?? null,
    categoryExactMatch,
    strengthCorrect: strength.strength === item.expectedStrength,
    entityExactMatch,
    criticalFailures,
  };
}

function extractEntities(
  segment: ReturnType<typeof asSegmentInputs>[number],
): SyntheticEntityExpectation[] {
  const entities: SyntheticEntityExpectation[] = [];
  const add = (type: NlpEntityType, value: string): void => {
    const entity = { type, value: normalizeText(value) };
    if (
      !entities.some((existing) => entityKey(existing) === entityKey(entity))
    ) {
      entities.push(entity);
    }
  };

  for (const mention of extractSkills(segment).mentions) {
    add('text', mention.normalizedName);
  }

  const experience = extractExperience(segment);
  if (experience.years !== null) {
    add('years', String(experience.years.minimum));
  }
  for (const clause of experience.nestedYears) {
    add('years', String(clause.minimum));
  }
  for (const clause of experience.alternatives) {
    add('years', String(clause.minimum));
  }

  for (const degree of extractEducation(segment).degrees) {
    add('degree-level', degree.level);
  }
  for (const certification of extractCertifications(segment).certifications) {
    add('certification', certification.key);
  }

  const clearance = extractClearance(segment);
  for (const item of clearance.clearances) {
    add('clearance-level', item.level);
  }
  for (const item of clearance.citizenship) {
    add('text', item.status);
  }

  const location = extractLocation(segment);
  for (const mention of location.locations) {
    add(mention.kind, mention.normalized);
  }
  if (location.commute.miles !== null) {
    add('text', `${String(location.commute.miles)} miles`);
  }
  if (location.travel.percent !== null) {
    add('percentage', String(location.travel.percent));
  }

  return entities.sort((left, right) =>
    entityKey(left).localeCompare(entityKey(right)),
  );
}

function summarizeCategories(
  results: readonly NlpCaseEvaluation[],
): CategoryEvaluationMetrics {
  const expected = results.reduce(
    (total, result) => total + result.expectedCategories.length,
    0,
  );
  const actual = results.reduce(
    (total, result) => total + result.actualCategories.length,
    0,
  );
  const truePositives = results.reduce(
    (total, result) =>
      total +
      intersectionCount(result.expectedCategories, result.actualCategories),
    0,
  );
  const falsePositives = results.reduce(
    (total, result) =>
      total +
      differenceCount(result.actualCategories, result.expectedCategories),
    0,
  );
  const falseNegatives = results.reduce(
    (total, result) =>
      total +
      differenceCount(result.expectedCategories, result.actualCategories),
    0,
  );
  const exactMatches = results.filter(
    (result) => result.categoryExactMatch,
  ).length;
  return {
    expected,
    actual,
    truePositives,
    falsePositives,
    falseNegatives,
    exactMatches,
    exactAccuracy: rate(exactMatches, results.length),
    precision: rate(truePositives, actual),
    recall: rate(truePositives, expected),
  };
}

function summarizeStrengths(
  results: readonly NlpCaseEvaluation[],
): StrengthEvaluationMetrics {
  const correct = results.filter((result) => result.strengthCorrect).length;
  return {
    total: results.length,
    correct,
    accuracy: rate(correct, results.length),
  };
}

function summarizeEntities(
  results: readonly NlpCaseEvaluation[],
): EntityEvaluationMetrics {
  const expected = results.reduce(
    (total, result) => total + result.expectedEntities.length,
    0,
  );
  const actual = results.reduce(
    (total, result) => total + result.actualEntities.length,
    0,
  );
  const matched = results.reduce(
    (total, result) =>
      total + intersectionCount(result.expectedEntities, result.actualEntities),
    0,
  );
  const falsePositives = results.reduce(
    (total, result) =>
      total + differenceCount(result.actualEntities, result.expectedEntities),
    0,
  );
  const falseNegatives = results.reduce(
    (total, result) =>
      total + differenceCount(result.expectedEntities, result.actualEntities),
    0,
  );
  const exactMatches = results.filter(
    (result) => result.entityExactMatch,
  ).length;
  return {
    expected,
    actual,
    matched,
    falsePositives,
    falseNegatives,
    exactMatches,
    exactAccuracy: rate(exactMatches, results.length),
    precision: rate(matched, actual),
    recall: rate(matched, expected),
  };
}

function summarizeArrangements(
  results: readonly NlpCaseEvaluation[],
): ArrangementEvaluationMetrics {
  const labeled = results.filter(
    (result) => result.expectedArrangement !== null,
  );
  const exactMatches = labeled.filter(
    (result) => result.actualArrangement === result.expectedArrangement,
  ).length;
  return {
    labeled: labeled.length,
    exactMatches,
    disagreementRate: rate(labeled.length - exactMatches, labeled.length),
  };
}

function summarizeCritical(
  results: readonly NlpCaseEvaluation[],
): CriticalEvaluationMetrics {
  const criticalResults = results.filter(
    (result) => result.kind === 'adversarial',
  );
  const failingCaseIds = criticalResults
    .filter((result) => result.criticalFailures.length > 0)
    .map((result) => result.id);
  const falsePositiveCount = criticalResults.reduce(
    (total, result) =>
      total +
      result.criticalFailures.filter(
        (failure) =>
          failure.startsWith('forbidden-category:') ||
          failure.startsWith('forbidden-entity:'),
      ).length,
    0,
  );
  const falseNegativeCount = criticalResults.reduce(
    (total, result) =>
      total +
      result.criticalFailures.filter((failure) =>
        failure.startsWith('missing-category:'),
      ).length,
    0,
  );
  return {
    cases: criticalResults.length,
    failingCaseIds,
    falsePositiveCount,
    falseNegativeCount,
    failureRate: rate(failingCaseIds.length, criticalResults.length),
  };
}

function intersectionCount<T>(left: readonly T[], right: readonly T[]): number {
  const leftKeys = new Set(left.map(toComparableKey));
  const rightKeys = new Set(right.map(toComparableKey));
  let count = 0;
  for (const key of leftKeys) {
    if (rightKeys.has(key)) count += 1;
  }
  return count;
}

function differenceCount<T>(left: readonly T[], right: readonly T[]): number {
  const leftKeys = new Set(left.map(toComparableKey));
  const rightKeys = new Set(right.map(toComparableKey));
  let count = 0;
  for (const key of leftKeys) {
    if (!rightKeys.has(key)) count += 1;
  }
  return count;
}

function toComparableKey(value: unknown): string {
  return typeof value === 'string'
    ? value
    : entityKey(value as SyntheticEntityExpectation);
}

function entityKey(entity: SyntheticEntityExpectation): string {
  return `${entity.type}:${normalizeText(entity.value)}`;
}

function setsEqual<T>(left: Set<T>, right: Set<T>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
