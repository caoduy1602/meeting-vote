const assert = require('assert');
const crypto = require('crypto');

async function main() {
  const pin = 'test-pin';
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const nodeHash = crypto.pbkdf2Sync(pin, salt, 210000, 32, 'sha256').toString('hex');
  const key = await crypto.webcrypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']
  );
  const edgeHash = Buffer.from(await crypto.webcrypto.subtle.deriveBits({
    name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256'
  }, key, 256)).toString('hex');

  assert.strictEqual(nodeHash, edgeHash);
  console.log('PBKDF2 implementations match');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});