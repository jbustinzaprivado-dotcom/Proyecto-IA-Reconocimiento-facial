const ALGORITHM_NAMES: Record<string, string> = {
  regresion_logistica: 'Regresión Logística',
  random_forest: 'Random Forest',
  gradient_boosting: 'Gradient Boosting',
}

// The name of an algorithm for the screen; an unknown one is shown as the API gave it
export function algorithmName(key: string): string {
  return ALGORITHM_NAMES[key] ?? key
}
