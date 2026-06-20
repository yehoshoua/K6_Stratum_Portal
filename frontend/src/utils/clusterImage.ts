export interface ClusterImageConfig {
  aws_account_id?: string;
  region?: string;
}

export interface ClusterImageSource {
  aws_account_id?: string;
  region?: string;
  api_server_url?: string;
}

export const DEFAULT_RUNNER_IMAGE_REPO = 'rem-helm-images/rem-apps/xk6:latest';

export const RUNNER_IMAGE_PLACEHOLDER =
  `AWS_ACCOUNT_ID.dkr.ecr.AWS_REGION.AWS_DOMAIN/${DEFAULT_RUNNER_IMAGE_REPO}`;

const KNOWN_AWS_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
  'sa-east-1', 'ca-central-1',
];

export function parseRegionFromAPIServer(apiServerURL?: string): string {
  if (!apiServerURL) {
    return '';
  }
  if (apiServerURL.includes('.eks.amazonaws.com')) {
    const parts = apiServerURL.split('.');
    for (let i = 0; i < parts.length; i += 1) {
      if (parts[i] === 'eks' && i > 0) {
        return parts[i - 1];
      }
    }
  }
  for (const region of KNOWN_AWS_REGIONS) {
    if (apiServerURL.includes(region)) {
      return region;
    }
  }
  return 'us-east-1';
}

export function clusterImageContext(
  cluster?: ClusterImageSource | null,
): ClusterImageConfig | null {
  if (!cluster) {
    return null;
  }
  const awsAccountId = cluster.aws_account_id?.trim();
  const region = cluster.region?.trim() || parseRegionFromAPIServer(cluster.api_server_url);
  if (!awsAccountId && !region) {
    return null;
  }
  return {
    aws_account_id: awsAccountId || undefined,
    region: region || undefined,
  };
}

export function defaultEcrDomain(region: string): string {
  return region.startsWith('cn-') ? 'amazonaws.com.cn' : 'amazonaws.com';
}

function ensureDomainSeparator(image: string, domain: string): string {
  const idx = image.indexOf(domain);
  if (idx === -1) {
    return image;
  }
  const nextIndex = idx + domain.length;
  if (nextIndex >= image.length) {
    return `${image}/`;
  }
  const next = image[nextIndex];
  if (next !== '/' && next !== ':') {
    return `${image.slice(0, nextIndex)}/${image.slice(nextIndex)}`;
  }
  return image;
}

export function resolveClusterImage(
  image: string,
  cluster?: ClusterImageConfig | null,
): string {
  let trimmed = image.trim().replace(/^\//, '');
  const accountId = cluster?.aws_account_id?.trim();
  const region = cluster?.region?.trim();
  if (!accountId || !region) {
    return trimmed;
  }

  const domain = defaultEcrDomain(region);
  const hasDomainPlaceholder = trimmed.includes('AWS_DOMAIN');
  trimmed = trimmed.replaceAll('AWS_ACCOUNT_ID', accountId);
  trimmed = trimmed.replaceAll('AWS_REGION', region);
  trimmed = trimmed.replaceAll('AWS_DOMAIN', domain);

  if (hasDomainPlaceholder) {
    trimmed = ensureDomainSeparator(trimmed, domain);
  }

  const targetRegistry = `${accountId}.dkr.ecr.${region}.${domain}`;
  const targetPrefix = `${targetRegistry}/`;
  if (trimmed.startsWith(targetPrefix)) {
    return trimmed;
  }

  const parts = trimmed.split('/');
  if (
    parts.length > 1 &&
    (parts[0].includes('.') || parts[0].includes(':') || parts[0] === 'localhost')
  ) {
    trimmed = parts.slice(1).join('/');
  }

  if (!trimmed) {
    return '';
  }
  return targetPrefix + trimmed;
}

export function defaultRunnerImage(
  cluster?: ClusterImageSource | null,
  override?: string,
): string {
  const base = override?.trim() || RUNNER_IMAGE_PLACEHOLDER;
  return resolveClusterImage(base, clusterImageContext(cluster));
}

export function needsResolvedRunnerImage(image: string): boolean {
  const trimmed = image.trim();
  return (
    trimmed === '' ||
    trimmed.includes('AWS_ACCOUNT_ID') ||
    trimmed.includes('AWS_REGION') ||
    trimmed.includes('AWS_DOMAIN') ||
    trimmed === DEFAULT_RUNNER_IMAGE_REPO ||
    !trimmed.includes('.dkr.ecr.')
  );
}
