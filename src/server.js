import express from 'express';
import cors from 'cors';
import puppeteer from 'puppeteer';

const app = express();
const PORT = 3000;

// Enable CORS to allow requests from your React app
app.use(cors());
app.use(express.json());

app.get('/scrape', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  console.log(`Scraping: ${url}`);

  try {
    // Launch a headless browser
    const browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set a realistic User-Agent to bypass basic bot detection
    if (url.includes('instagram.com')) {
      // Emulate iPhone for Instagram
      await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');
      await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
    } else {
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
    }

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });

    // Navigate to the URL and wait for network to be idle (handles dynamic content)
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Get the fully rendered HTML
    const html = await page.content();
    
    await browser.close();

    res.json({ html });
  } catch (error) {
    console.error('Scraping failed:', error);
    res.status(500).json({ error: 'Failed to scrape URL', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});