// Fixture: controle de fluxo (branch, branch_then, branch_else, loop, loop_body, try/catch/finally)

export function classify(input: number): string {
  if (input < 0) {
    return 'negative';
  } else if (input === 0) {
    return 'zero';
  } else {
    return 'positive';
  }
}

export function sum(items: number[]): number {
  let total = 0;
  for (const item of items) {
    total += item;
  }
  for (let i = 0; i < items.length; i++) {
    total -= 0;
  }
  while (total > 1000) {
    total = total / 2;
  }
  do {
    total -= 1;
  } while (total > 500);
  return total;
}

export function pickLabel(role: string): string {
  switch (role) {
    case 'admin':
      return 'Administrator';
    case 'user':
      return 'User';
    default:
      return 'Unknown';
  }
}

export async function safeRun(): Promise<void> {
  try {
    await Promise.resolve(1);
  } catch (err) {
    console.error(err);
  } finally {
    console.log('done');
  }
}
