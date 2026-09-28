const effortToBudgetMultiplier = {
  minimal: 0,
  low: 0.2,
  medium: 0.5,
  high: 0.8,
} as const;

export const getBudgetMultiplier = (
  effort: keyof typeof effortToBudgetMultiplier,
) => {
  return effortToBudgetMultiplier[effort] || effortToBudgetMultiplier.low;
};
