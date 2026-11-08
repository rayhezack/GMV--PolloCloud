export const LOCAL_DATA_WINDOW: { startDate: string; endDate: string } | null =
  import.meta.env.VITE_LOCAL_DATA_WINDOW ?? null;

export const LOCAL_REVENUE_WINDOW = import.meta.env.VITE_LOCAL_REVENUE_WINDOW ?? LOCAL_DATA_WINDOW;
