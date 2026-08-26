export type ChoiceCount = {
  choiceId: string;
  acceptedCount: number;
};

export type ChoiceDistribution = {
  displayedTotal: number;
  topTwoGapRatio: number | null;
  normalizedEntropy: number | null;
};

function assertChoiceCounts(choices: readonly ChoiceCount[]) {
  if (choices.length < 2 || choices.length > 4) {
    throw new RangeError("A Choice distribution must contain between two and four Choices.");
  }

  if (new Set(choices.map((choice) => choice.choiceId)).size !== choices.length) {
    throw new TypeError("Choice identifiers must be unique.");
  }

  for (const choice of choices) {
    if (!Number.isSafeInteger(choice.acceptedCount) || choice.acceptedCount < 0) {
      throw new RangeError("Accepted Choice counts must be non-negative safe integers.");
    }
  }
}

/**
 * Executable reference for the PICK migration spike.
 *
 * The top-two gap is the primary closeness signal. Normalized entropy is a
 * secondary distribution signal that remains comparable across two, three,
 * and four Choice Issues. No production ranking path consumes this helper yet.
 */
export function calculateChoiceDistribution(choices: readonly ChoiceCount[]): ChoiceDistribution {
  assertChoiceCounts(choices);

  const displayedTotal = choices.reduce((total, choice) => total + choice.acceptedCount, 0);
  if (displayedTotal === 0) {
    return { displayedTotal, topTwoGapRatio: null, normalizedEntropy: null };
  }

  const sortedCounts = choices
    .map((choice) => choice.acceptedCount)
    .sort((left, right) => right - left);
  const topTwoGapRatio = (sortedCounts[0]! - sortedCounts[1]!) / displayedTotal;
  const entropy = choices.reduce((total, choice) => {
    if (choice.acceptedCount === 0) return total;
    const probability = choice.acceptedCount / displayedTotal;
    return total - probability * Math.log(probability);
  }, 0);

  return {
    displayedTotal,
    topTwoGapRatio,
    normalizedEntropy: entropy / Math.log(choices.length),
  };
}
