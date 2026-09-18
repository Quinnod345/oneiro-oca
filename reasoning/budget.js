// Deployment default only. Every request still validates (0, 180] and an
// explicitly supplied smaller budget always wins. Existing saved wants retain theirs.
export const defaultTimeBudgetSeconds = Number(process.env.ONEIRO_PONDER_TIME_BUDGET_SECONDS || 45);
