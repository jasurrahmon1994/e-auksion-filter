const https = require('https');

function get(path) {
  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname: 'e-auksion.uz',
      path,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' }
    }, (resp) => {
      const c = [];
      resp.on('data', d => c.push(d));
      resp.on('end', () => resolve(Buffer.concat(c).toString()));
    });
    r.on('error', reject);
    r.end();
  });
}

const crypto = require('crypto');

function solvePow(nonce, difficulty) {
  const prefix = nonce + ':';
  for (let i = 0; i < 50000000; i++) {
    const hash = crypto.createHash('sha256').update(prefix + i).digest();
    let bits = 0;
    for (let j = 0; j < hash.length; j++) {
      const v = hash[j];
      if (v === 0) { bits += 8; continue; }
      for (let mask = 0x80; mask !== 0 && (v & mask) === 0; mask >>= 1) bits++;
      break;
    }
    if (bits >= difficulty) return String(i);
  }
  return null;
}

async function run() {
  // Step 1: Get challenge
  const r1 = await get('/api/front/lot-info?lot_id=2050741&lang=uz');
  const challenge = JSON.parse(r1);
  console.log('Challenge:', challenge.challenge);
  console.log('Difficulty:', challenge.difficulty);

  // Step 2: Solve
  const nonce = challenge.challenge.split('.')[1];
  console.log('Nonce:', nonce);
  const solution = solvePow(nonce, challenge.difficulty);
  console.log('Solution:', solution);

  // Step 3: Verify - try different paths
  const verifyBody = JSON.stringify({ challenge: challenge.challenge, solution });
  const paths = ['/api/proof/verify', '/api/front/proof/verify', '/proof/verify', '/api/pow/verify'];
  for (const p of paths) {
    try {
      const resp = await post(p, verifyBody);
      console.log(`POST ${p}:`, resp.substring(0, 200));
    } catch(e) {
      console.log(`POST ${p}: ERROR`, e.message);
    }
  }

  // Step 4: Use token if found
  console.log('\nDone.');
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname: 'e-auksion.uz', path, method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Referer': 'https://e-auksion.uz/'
      }
    }, (resp) => {
      const c = [];
      resp.on('data', d => c.push(d));
      resp.on('end', () => resolve(Buffer.concat(c).toString()));
    });
    r.on('error', reject);
    r.write(body);
    r.end();
  });
}

function getWithToken(path, token) {
  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname: 'e-auksion.uz', path, method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://e-auksion.uz/',
        'X-Proof-Token': token
      }
    }, (resp) => {
      const c = [];
      resp.on('data', d => c.push(d));
      resp.on('end', () => resolve(Buffer.concat(c).toString()));
    });
    r.on('error', reject);
    r.end();
  });
}

run().catch(e => console.error(e));
