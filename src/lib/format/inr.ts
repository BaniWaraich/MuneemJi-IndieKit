export function formatINR(paise: bigint | number): string {
  const asNumber = typeof paise === 'bigint' ? Number(paise) : paise;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
    asNumber / 100,
  );
}

export function formatDateIN(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(d);
}
