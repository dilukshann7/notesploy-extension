import { describe, expect, it } from 'vitest';
import { createPkcePair, randomVerifier, s256Challenge } from '../src/lib/pkce';

// Reference computed with Node's crypto: base64url(SHA-256(verifier)).
const REFERENCE_VERIFIER = 'dBjftJeZ4CVP-mJ92K1fNTNoWXTjjDRZnk6ewKpDS9P0q0Y4c';
const REFERENCE_CHALLENGE = 'We3cwfD2mUh2DqOxiUWOSmIlLOMItOfHHwpDinQQ2iE';

describe('pkce', () => {
  it('computes the S256 challenge for a known verifier', async () => {
    expect(await s256Challenge(REFERENCE_VERIFIER)).toBe(REFERENCE_CHALLENGE);
  });

  it('produces 43-character unpadded base64url challenges', async () => {
    const challenge = await s256Challenge(randomVerifier());
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('generates 64-character base64url verifiers that differ each time', () => {
    const first = randomVerifier();
    const second = randomVerifier();
    expect(first).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(second).not.toBe(first);
  });

  it('creates a verifier whose challenge matches its S256 hash', async () => {
    const { verifier, challenge } = await createPkcePair();
    expect(verifier).toHaveLength(64);
    expect(challenge).toBe(await s256Challenge(verifier));
  });
});
