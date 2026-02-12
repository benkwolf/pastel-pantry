import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    
    // Optimization: Block images, fonts, and styles to speed up load and save bandwidth
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Mobile Emulation for Instagram to bypass desktop login walls
    if (url.includes('instagram.com')) {
      await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');
      await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
    } else {
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
    }
    
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });

    // Vercel free tier has a 10s timeout. Wrap goto in try/catch to return content even if it times out.
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 7000 });
    } catch (e) {
      console.log("Navigation timed out, capturing available content.");
    }

    const html = await page.content();
    
    await browser.close();
    res.status(200).json({ html });
  } catch (error) {
    if (browser) await browser.close();
    res.status(500).json({ error: error.message });
  }
}