import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    // Vercel free tier has a 10s timeout, so we set a tight timeout here
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 8000 });
    const html = await page.content();
    
    await browser.close();
    res.status(200).json({ html });
  } catch (error) {
    if (browser) await browser.close();
    res.status(500).json({ error: error.message });
  }
}