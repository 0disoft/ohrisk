export type UsageProfile = "saas" | "distributed-app";

export const USAGE_PROFILES: readonly UsageProfile[] = [
  "saas",
  "distributed-app"
];

export function isUsageProfile(value: string): value is UsageProfile {
  return (USAGE_PROFILES as readonly string[]).includes(value);
}
