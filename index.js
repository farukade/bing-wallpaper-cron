import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';

// Configurations
const BING_ENDPOINT = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US';
const DB_FILE = path.join(process.cwd(), 'wallpapers.json');

/**
 * Ensures the database file exists without overwriting existing data.
 */
async function initializeDatabase() {
  try {
    await fs.access(DB_FILE);
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify([], null, 2));
    console.log('📁 Created wallpapers.json database file.');
  }
}

/**
 * Fetches the latest Bing wallpaper and appends it to local storage.
 */
async function fetchAndSaveWallpaper() {
  console.log(`[${new Date().toISOString()}] Checking for latest Bing wallpaper...`);

  try {
    // 1. Query the Bing API
    const response = await fetch(BING_ENDPOINT);
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    const imageData = data.images?.[0];

    if (!imageData) {
      throw new Error('No image returned from Bing API.');
    }

    // 2. Parse the high-res 4K URL and image metadata
    const wallpaperRecord = {
      id: imageData.startdate,
      title: imageData.title || 'Bing Daily Wallpaper',
      copyright: imageData.copyright,
      date: imageData.startdate,
      url: `https://www.bing.com${imageData.url}`,
      url_uhd: `https://www.bing.com${imageData.urlbase}_UHD.jpg`, // 4K Resolution variant
      fetchedAt: new Date().toISOString()
    };

    // 3. Read current stored wallpapers
    const fileData = await fs.readFile(DB_FILE, 'utf-8');
    const db = JSON.parse(fileData);

    // 4. Avoid duplicates (Check if wallpaper for today already exists)
    const exists = db.some((item) => item.id === wallpaperRecord.id);

    if (exists) {
      console.log(`ℹ️ Wallpaper for ${wallpaperRecord.date} is already saved.`);
      return;
    }

    // 5. Save updated list
    db.unshift(wallpaperRecord); // Add newest wallpaper to the top
    await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));

    console.log(`✅ Saved new wallpaper: "${wallpaperRecord.title}" (${wallpaperRecord.date})`);
  } catch (error) {
    console.error('❌ Failed to fetch/save Bing wallpaper:', error.message);
  }
}

// Start app
await initializeDatabase();

// Run immediately on boot
await fetchAndSaveWallpaper();

// Schedule cron task to run daily at 00:05 AM (Server time)
// Cron Syntax: (Minute Hour Day-of-Month Month Day-of-Week)
cron.schedule('5 0 * * *', async () => {
  console.log('⏰ Running daily scheduled fetch...');
  await fetchAndSaveWallpaper();
});

console.log('🚀 Service started. Cron job running daily at 00:05 AM.');