export type DefaultProfileSeed = {
  industry?: string;
  description?: string;
};

/** Minimal Tier-1 profile so D03 can run before O03 onboarding is complete. */
export function defaultClientProfileValues(seed: DefaultProfileSeed = {}) {
  const industry = (seed.industry?.trim() || "General").slice(0, 100);
  const description = (
    seed.description?.trim() ||
    "Business profile not yet completed — using defaults for statement interpretation."
  ).slice(0, 500);

  return {
    legalStructure: "sole_proprietorship" as const,
    businessType: "mixed" as const,
    industry,
    description,
    gstRegistrationType: "unregistered" as const,
    primaryTransactionMode: "mostly_digital" as const,
    invoiceSoftware: "manual" as const,
    hasInterCompanyTransactions: false,
    bankAccounts: [] as [],
  };
}
