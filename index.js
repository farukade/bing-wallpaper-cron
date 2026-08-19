import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';
import { setWallpaper } from 'wallpaper';

// Configurations
const BING_ENDPOINT = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US';
const API_ENDPOINT = process.env.WALLPAPER_API_URL || BING_ENDPOINT;
const DB_FILE = path.join(process.cwd(), 'wallpapers.db');
const LEGACY_JSON_FILE = path.join(process.cwd(), 'wallpapers.json');
const IMAGE_DIR = path.join(process.cwd(), 'wallpapers');

const db = new Database(DB_FILE);

db.exec(`
  CREATE TABLE IF NOT EXISTS wallpapers (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    copyright TEXT,
    date TEXT NOT NULL,
    url TEXT NOT NULL,
    url_uhd TEXT NOT NULL,
    fetchedAt TEXT NOT NULL
  );
`);

const insertWallpaper = db.prepare(`
  INSERT OR IGNORE INTO wallpapers (id, title, copyright, date, url, url_uhd, fetchedAt)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

/**
 * One-time migration: imports any existing data from wallpapers.json into SQLite,
 * then removes the legacy file.
 */
async function migrateLegacyData() {
  try {
    const fileData = await fs.readFile(LEGACY_JSON_FILE, 'utf-8');
    const records = JSON.parse(fileData);

    if (!Array.isArray(records) || records.length === 0) {
      await fs.unlink(LEGACY_JSON_FILE);
      console.log('📁 No legacy data found in wallpapers.json, removed file.');
      return;
    }

    const { count } = db.prepare('SELECT COUNT(*) AS count FROM wallpapers').get();
    if (count > 0) {
      console.log(`ℹ️ Database already has ${count} records. Skipping migration.`);
      return;
    }

    const migrateAll = db.transaction((items) => {
      for (const item of items) {
        insertWallpaper.run(
          item.id,
          item.title,
          item.copyright ?? null,
          item.date,
          item.url,
          item.url_uhd,
          item.fetchedAt
        );
      }
    });

    migrateAll(records);
    await fs.unlink(LEGACY_JSON_FILE);

    console.log(`📁 Migrated ${records.length} records from wallpapers.json into wallpapers.db.`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('❌ Failed to migrate legacy data:', error.message);
    }
  }
}

/**
 * Fetches the latest wallpaper and appends it to local storage.
 * Also downloads and applies it as the desktop wallpaper.
 */
async function fetchAndSaveWallpaper() {
  console.log(`[${new Date().toISOString()}] Checking for latest wallpaper...`);

  try {
    // 1. Query the API
    const response = await fetch(API_ENDPOINT);
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    const imageData = data.images?.[0];

    if (!imageData) {
      throw new Error('No image returned from API.');
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

    // 3. Save (ignore if the wallpaper for today is already stored)
    const result = insertWallpaper.run(
      wallpaperRecord.id,
      wallpaperRecord.title,
      wallpaperRecord.copyright,
      wallpaperRecord.date,
      wallpaperRecord.url,
      wallpaperRecord.url_uhd,
      wallpaperRecord.fetchedAt
    );

    const isNew = result.changes === 1;

    if (!isNew) {
      console.log(`ℹ️ Wallpaper for ${wallpaperRecord.date} is already current.`);
    }

    // 4. Ensure the wallpaper is applied. Re-downloads only if not cached,
    //    otherwise just re-applies the cached image.
    await applyDesktopWallpaper(wallpaperRecord);

    if (isNew) {
      console.log(`✅ Saved new wallpaper: "${wallpaperRecord.title}" (${wallpaperRecord.date})`);
    }
  } catch (error) {
    console.error('❌ Failed to fetch/save wallpaper:', error.message);
  }
}

/**
 * Downloads the high-res image (unless already cached) and sets it as the desktop wallpaper.
 */
async function applyDesktopWallpaper(wallpaperRecord) {
  await fs.mkdir(IMAGE_DIR, { recursive: true });
  const imagePath = path.join(IMAGE_DIR, `${wallpaperRecord.id}.jpg`);

  try {
    await fs.access(imagePath);
  } catch {
    const response = await fetch(wallpaperRecord.url_uhd);
    if (!response.ok) {
      throw new Error(`HTTP Error downloading image: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(imagePath, buffer);
  }

  await setWallpaper(imagePath);
  console.log(`🖥️ Desktop wallpaper applied: ${imagePath}`);
}

// Start app
await migrateLegacyData();

// Run immediately on boot
await fetchAndSaveWallpaper();

// Schedule cron task to run every 30 minutes.
// Downloads only apply when Bing publishes a new image (see fetchAndSaveWallpaper).
// suppressMissedWarning: macOS skips timer ticks while the Mac is asleep; on wake
// node-cron logs a "missed execution" warning for each. That is expected, not an error.
cron.schedule('*/30 * * * *', async () => {
  console.log('⏰ Running scheduled fetch...');
  await fetchAndSaveWallpaper();
}, { suppressMissedWarning: true });

console.log('🚀 Service started. Cron job running every 30 minutes.');