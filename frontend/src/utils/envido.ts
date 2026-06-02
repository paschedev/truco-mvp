function valorEnvido(carta: string): number {
  const num = parseInt(carta.split("-")[0]);
  return num >= 10 ? 0 : num;
}

export function getEnvidoInfo(mano: string[]): { points: number; contributorCards: string[] } {
  if (!mano || mano.length === 0) {
    return { points: 0, contributorCards: [] };
  }

  // Agrupar por palo
  const groups: Record<string, string[]> = {};
  mano.forEach((carta) => {
    const parts = carta.split("-");
    if (parts.length === 2) {
      const palo = parts[1];
      if (!groups[palo]) groups[palo] = [];
      groups[palo].push(carta);
    }
  });

  let maxPoints = -1;
  let contributors: string[] = [];

  // Flor o Envido (2 o más del mismo palo)
  for (const palo in groups) {
    const group = groups[palo];
    if (group.length >= 2) {
      // Sumar los dos valores de envido más altos del grupo + 20
      const sorted = [...group]
        .map((c) => ({ card: c, val: valorEnvido(c) }))
        .sort((a, b) => b.val - a.val);

      let points = 20;
      let selected: string[] = [];
      if (sorted.length >= 2) {
        points += sorted[0].val + sorted[1].val;
        selected = [sorted[0].card, sorted[1].card];
      } else {
        points += sorted[0].val;
        selected = [sorted[0].card];
      }

      if (points > maxPoints) {
        maxPoints = points;
        contributors = selected;
      }
    }
  }

  // Si no hay 2 de un mismo palo, tomamos la carta de mayor valor individual
  if (maxPoints === -1) {
    const sorted = mano
      .map((c) => ({ card: c, val: valorEnvido(c) }))
      .sort((a, b) => b.val - a.val);

    if (sorted.length > 0) {
      maxPoints = sorted[0].val;
      contributors = [sorted[0].card];
    } else {
      maxPoints = 0;
      contributors = [];
    }
  }

  return { points: maxPoints, contributorCards: contributors };
}
