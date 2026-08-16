import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';

// Configurations
const BING_ENDPOINT = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US';
const DB_FILE = path.join(process.cwd(), 'wallpapers.db');
const LEGACY_JSON_FILE = path.join(process.cwd(), 'wallpapers.json');

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

    if (result.changes === 0) {
      console.log(`ℹ️ Wallpaper for ${wallpaperRecord.date} is already saved.`);
      return;
    }

    console.log(`✅ Saved new wallpaper: "${wallpaperRecord.title}" (${wallpaperRecord.date})`);
  } catch (error) {
    console.error('❌ Failed to fetch/save Bing wallpaper:', error.message);
  }
}

// Start app
await migrateLegacyData();

// Run immediately on boot
await fetchAndSaveWallpaper();

// Schedule cron task to run daily at 00:05 AM (Server time)
// Cron Syntax: (Minute Hour Day-of-Month Month Day-of-Week)
cron.schedule('5 0 * * *', async () => {
  console.log('⏰ Running daily scheduled fetch...');
  await fetchAndSaveWallpaper();
});

console.log('🚀 Service started. Cron job running daily at 00:05 AM.');