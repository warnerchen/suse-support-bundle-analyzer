const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'have',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'when',
  'with',
  'you',
  'your',
]);

export class LocalEmbeddingProvider {
  constructor({ dimensions = 256 } = {}) {
    if (!Number.isInteger(dimensions) || dimensions < 32) {
      throw new Error('KB embedding dimensions must be an integer greater than or equal to 32.');
    }

    this.dimensions = dimensions;
  }

  get descriptor() {
    return {
      provider: 'local-hash-v1',
      dimensions: this.dimensions,
    };
  }

  embedText(text) {
    const vector = new Array(this.dimensions).fill(0);
    const tokens = tokenize(text);

    for (let index = 0; index < tokens.length; index += 1) {
      addToken(vector, tokens[index], 1);

      if (index < tokens.length - 1) {
        addToken(vector, `${tokens[index]} ${tokens[index + 1]}`, 1.35);
      }
    }

    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0));

    if (!magnitude) {
      return vector;
    }

    return vector.map((value) => Number((value / magnitude).toFixed(6)));
  }
}

export function cosineSimilarity(left, right) {
  const length = Math.min(left.length, right.length);
  let score = 0;

  for (let index = 0; index < length; index += 1) {
    score += left[index] * right[index];
  }

  return score;
}

export function tokenize(text) {
  return (String(text).toLowerCase().match(/[a-z0-9][a-z0-9._-]*/g) ?? []).filter(
    (token) => token.length > 1 && !STOP_WORDS.has(token),
  );
}

function addToken(vector, token, weight) {
  const bucket = fnv1a(token) % vector.length;
  vector[bucket] += weight;
}

function fnv1a(value) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}
