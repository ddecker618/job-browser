import type {
  DiscoveryOptions,
  ProviderSearch,
  SearchRequest,
} from '../models/discovery.js';
import type {
  ProviderConfiguration,
  ValidationResult,
} from '../models/source-management.js';
import { WorkdayProvider } from './workday.provider.js';

export class CrowdStrikeProvider extends WorkdayProvider {
  public override readonly id: string = 'crowdstrike';
  public override readonly name: string = 'CrowdStrike Careers';

  private readonly hardcodedConfig = {
    origin: 'https://crowdstrike.wd5.myworkdayjobs.com',
    tenant: 'crowdstrike',
    site: 'crowdstrikecareers',
    company: 'CrowdStrike',
  };

  public override validateConfiguration(
    configuration: ProviderConfiguration,
  ): Promise<ValidationResult> {
    const merged = {
      ...this.hardcodedConfig,
      ...configuration,
    };
    const origin = new URL(merged.origin).origin;
    return Promise.resolve({
      valid: true,
      message: `${this.name} configuration is valid`,
      normalizedConfiguration: { ...merged, origin },
      preview: null,
    });
  }

  public override search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch> {
    return super.search(request, {
      ...options,
      configuration: {
        ...this.hardcodedConfig,
        ...(options.configuration ?? {}),
      },
    });
  }
}

export default new CrowdStrikeProvider();
