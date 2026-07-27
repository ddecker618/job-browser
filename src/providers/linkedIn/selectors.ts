export const LINKEDIN_SELECTORS = {
  loginEmail: '#session_key',
  loginPassword: '#session_password',
  loginSubmit: 'button[type="submit"]',
  searchResultsContainer: '.jobs-search-results-list',
  jobCard: '.job-card-container',
  jobCardLink: '.job-card-list__title a',
  jobCardTitle:
    '.job-card-list__title, .job-card-search__title, .job-card-container__link',
  jobCardCompany:
    '.job-card-container__company-name, .artdeco-entity-lockup__subtitle span',
  jobCardLocation: '.job-card-container__metadata-item, .t-black--light span',
  jobCardSalary:
    '.job-card-container__salary-info, .job-card-search__salary-info',
  jobCardFooter: '.job-card-container__footer-wrapper',
  jobCardInsight: '.job-card-container__insight',
  jobDetailTitle:
    '.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title',
  jobDetailCompany:
    '.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name a',
  jobDetailLocation:
    '.job-details-jobs-unified-top-card__bullet, .jobs-unified-top-card__bullet',
  jobDetailDescription:
    '.job-details-jobs-unified-top-card__description-container, .jobs-description__content, .job-view-layout jobs-description',
  jobDetailDescriptionContent:
    '.jobs-description-content__text, .job-details-jobs-unified-top-card__description, .jobs-box__html-content',
  jobDetailCriteria:
    '.job-details-jobs-unified-top-card__job-insight, .jobs-unified-top-card__job-insight',
  jobDetailSalary:
    '.job-details-jobs-unified-top-card__salary-info, .jobs-unified-top-card__salary-info',
  jobDetailCriteriaItems:
    'li.job-criteria__item, .jobs-unified-top-card__job-insight span',
  jobDetailApplicantCount:
    '.job-details-jobs-unified-top-card__applicant-count, .jobs-unified-top-card__applicant-count',
  jobDetailEasyApply: '.jobs-easy-apply-button, button[data-easy-apply]',
  promotedLabel: '.job-card-container__apply-method-NOT_APPLIED',
  searchResultListItem:
    '.jobs-search-results__list-item, ul.jobs-search-results__list > li',
  searchResultCard: 'div.job-card-container',
  paginationNext:
    'button[aria-label="Next"], .artdeco-pagination__button--next',
  paginationActive: '.artdeco-pagination__indicator--active',
  securityChallenge:
    '#captcha-internal, #security-challenge, .challenge-dialog',
  securityPrompt: 'div[data-challenge-id], form[data-challenge]',
  navMe: '#ember-nav-profile, .global-nav__primary-link--profile',
  feedMain: '.feed-shared-update-v2, .feed-shared-update',
  jobSearchForm: '.jobs-search-box__input, .jobs-search-box--hero',
  ghostStyles: '.job-card-container--clickable',
} as const;

export type LinkedInSelector = keyof typeof LINKEDIN_SELECTORS;

export function selector(key: LinkedInSelector): string {
  const value = LINKEDIN_SELECTORS[key];
  return typeof value === 'string' ? value : String(value);
}
