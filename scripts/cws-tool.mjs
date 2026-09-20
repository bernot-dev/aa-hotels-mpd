import fs from 'node:fs';

const extensionId = process.env.EXTENSION_ID;
const publisherId = process.env.PUBLISHER_ID;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const refreshToken = process.env.REFRESH_TOKEN;

async function getToken() {
  const res = await fetch('https://www.googleapis.com/oauth2/v4/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Token fetch failed: ' + JSON.stringify(data));
  return data.access_token;
}

export async function checkStatus() {
  const token = await getToken();
  const url = `https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${extensionId}:fetchStatus`;
  console.log(`\n=== Querying CWS Status (${url}) ===`);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  console.log(`Status HTTP ${res.status}:`);
  try {
    const json = JSON.parse(text);
    console.log(JSON.stringify(json, null, 2));
    return json;
  } catch {
    console.log(text);
    return null;
  }
}

export async function uploadPackage(zipPath) {
  const token = await getToken();
  const stats = fs.statSync(zipPath);
  const fileBuffer = fs.readFileSync(zipPath);
  const url = `https://chromewebstore.googleapis.com/upload/v2/publishers/${publisherId}/items/${extensionId}:upload`;
  console.log(`\n=== Uploading ${zipPath} (${stats.size.toLocaleString()} bytes) to Chrome Web Store ===`);
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Goog-Upload-Protocol': 'raw',
      'X-Goog-Upload-File-Name': 'extension.zip',
      'Content-Length': String(stats.size),
      'Content-Type': 'application/zip',
    },
    body: fileBuffer,
  });

  const text = await res.text();
  console.log(`Upload HTTP ${res.status} ${res.statusText}:`);
  try {
    const json = JSON.parse(text);
    console.log(JSON.stringify(json, null, 2));
    if (!res.ok || json.uploadState === 'FAILED') {
      throw new Error(`Upload rejected by Google: ${text}`);
    }
    return json;
  } catch (err) {
    if (!res.ok) throw err;
    console.log(text);
    return null;
  }
}

export async function publishItem() {
  const token = await getToken();
  const url = `https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${extensionId}:publish`;
  console.log(`\n=== Submitting Item for Review (${url}) ===`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
  });
  const text = await res.text();
  console.log(`Publish HTTP ${res.status} ${res.statusText}:`);
  try {
    const json = JSON.parse(text);
    console.log(JSON.stringify(json, null, 2));
    if (!res.ok) throw new Error(`Publish failed: ${text}`);
    return json;
  } catch (err) {
    if (!res.ok) throw err;
    console.log(text);
    return null;
  }
}

const action = process.argv[2] || 'status';
if (action === 'status') {
  await checkStatus();
} else if (action === 'upload') {
  const zip = process.argv[3] || 'extension.zip';
  await uploadPackage(zip);
  await checkStatus();
} else if (action === 'publish') {
  await publishItem();
  await checkStatus();
}
