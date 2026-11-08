export function sumMicroDollars(values: number[]) {
  return values.reduce((total, value) => total + Math.round(value * 1000000), 0) / 1000000;
}
