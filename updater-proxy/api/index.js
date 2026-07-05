export default async function handler(req, res) {
  // CORS Headers for Tauri
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'GITHUB_TOKEN is not set in Vercel Environment Variables' });
  }

  const repo = 'bdrwss/VoiceFlow_AI';
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Vercel-Updater-Proxy'
  };

  try {
    // 1. Fetch latest release info
    const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
    if (!releaseRes.ok) throw new Error(`GitHub API error: ${releaseRes.status} ${releaseRes.statusText}`);
    const release = await releaseRes.json();

    // 2. Find latest.json asset
    const latestJsonAsset = release.assets.find(a => a.name === 'latest.json');
    if (!latestJsonAsset) throw new Error('latest.json not found. Available assets: ' + release.assets.map(a => a.name).join(', '));

    // 3. Download latest.json content
    const assetRes = await fetch(latestJsonAsset.url, {
      headers: { ...headers, 'Accept': 'application/octet-stream' }
    });
    if (!assetRes.ok) throw new Error(`Failed to download latest.json: ${assetRes.status}`);
    const latestJsonStr = await assetRes.text();
    const latestData = JSON.parse(latestJsonStr);

    // 4. Rewrite URLs to point to our proxy download endpoint
    const host = req.headers.host;
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const baseUrl = `${protocol}://${host}/api/download`;

    const githubDownloadBase = `https://github.com/${repo}/releases/download/`;
    
    // Tauri v2 latest.json structure
    if (latestData.platforms) {
      for (const [platform, data] of Object.entries(latestData.platforms)) {
        if (data.url && data.url.startsWith(githubDownloadBase)) {
          const parts = data.url.replace(githubDownloadBase, '').split('/');
          if (parts.length >= 2) {
            const tag = parts[0];
            const file = parts[1];
            // Rewrite the URL
            data.url = `${baseUrl}?tag=${encodeURIComponent(tag)}&file=${encodeURIComponent(file)}`;
          }
        }
      }
    }

    res.status(200).json(latestData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
