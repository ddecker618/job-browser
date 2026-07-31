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

export class CiscoProvider extends WorkdayProvider {
  public override readonly id: string = 'cisco';
  public override readonly name: string = 'Cisco Careers';

  private readonly hardcodedConfig = {
    origin: 'https://cisco.wd5.myworkdayjobs.com',
    tenant: 'cisco',
    site: 'Cisco_Careers',
    company: 'Cisco',
  };

  public override async validateConfiguration(
    configuration: ProviderConfiguration,
  ): Promise<ValidationResult> {
    const merged = {
      ...this.hardcodedConfig,
      ...configuration,
    };
    const origin = new URL(merged.origin).origin;
    return {
      valid: true,
      message: `${this.name} configuration is valid`,
      normalizedConfiguration: { ...merged, origin },
      preview: null,
    };
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

export default new CiscoProvider();
