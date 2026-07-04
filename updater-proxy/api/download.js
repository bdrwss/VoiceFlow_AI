export default async function handler(req, res) {
  // CORS Headers for Tauri
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { tag, file } = req.query;
  if (!tag || !file) {
    return res.status(400).json({ error: 'Missing tag or file parameter' });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'GITHUB_TOKEN is not set' });
  }

  const repo = 'bdrwss/VoiceFlow_AI';
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Vercel-Updater-Proxy'
  };

  try {
    // 1. Fetch release by tag to get asset ID
    const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { headers });
    if (!releaseRes.ok) throw new Error(`Release not found for tag: ${tag}`);
    const release = await releaseRes.json();

    // 2. Find the requested asset by filename
    const asset = release.assets.find(a => a.name === file);
    if (!asset) throw new Error(`Asset not found: ${file}`);

    // 3. Fetch the asset binary stream. 
    // GitHub API will return a 302 Found redirect to a temporary AWS S3 URL.
    const assetRes = await fetch(asset.url, {
      headers: { ...headers, 'Accept': 'application/octet-stream' },
      redirect: 'manual' // Catch the 302 redirect manually
    });

    if (assetRes.status === 302 || assetRes.status === 301) {
       const location = assetRes.headers.get('location');
       if (location) {
         // Redirect the Tauri client directly to the raw S3 URL!
         // This bypasses Vercel's payload limits and saves bandwidth!
         res.setHeader('Location', location);
         return res.status(302).end();
       }
    }
    
    // Fallback if GitHub didn't redirect (e.g. they changed their API behavior)
    if (assetRes.ok) {
        // Stream it directly
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
        // Vercel Serverless Functions support web streams in Node 18+
        return res.send(assetRes.body);
    }

    res.status(500).json({ error: 'Failed to download asset from GitHub' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
