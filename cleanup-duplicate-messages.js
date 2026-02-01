/**
 * Cleanup script to remove duplicate image messages from userChat collection
 *
 * The bug was in MongoDB queries that checked for batchId AND batchIndex separately,
 * which could match different array elements instead of the same one.
 *
 * Usage: node cleanup-duplicate-messages.js [--dry-run]
 *   --dry-run: Show what would be cleaned without making changes
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
const dbName = process.env.MONGODB_NAME || process.env.DB_NAME || 'lamix';

// Check for dry-run flag
const isDryRun = process.argv.includes('--dry-run');

// Helper function to format elapsed time
function formatElapsedTime(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

// Helper function to log with timestamp
function log(message) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  console.log(`[${timestamp}] ${message}`);
}

async function main() {
  const startTime = Date.now();
  log('🚀 Starting cleanup script...');
  
  const client = new MongoClient(uri);

  try {
    log('📡 Connecting to MongoDB...');
    const connectStart = Date.now();
    await client.connect();
    log(`✅ Connected to MongoDB (${formatElapsedTime(Date.now() - connectStart)})`);
    console.log(isDryRun ? '🔍 DRY RUN MODE - No changes will be made\n' : '⚠️  LIVE MODE - Changes will be applied\n');

    const db = client.db(dbName);
    log(`📂 Using database: ${dbName}`);
    const userChatCollection = db.collection('userChat');

    // Count total documents first for progress tracking
    log('📊 Counting total documents...');
    const countStart = Date.now();
    const totalCount = await userChatCollection.countDocuments({});
    log(`📊 Total documents to process: ${totalCount} (${formatElapsedTime(Date.now() - countStart)})`);

    // Get all userChat documents
    log('🔄 Starting document scan...\n');
    const scanStart = Date.now();
    
    // Use batching for better performance - fetch documents in batches
    log('📥 Creating cursor with batch size 100...');
    const cursor = userChatCollection.find({}).sort({_id: -1}).batchSize(100);

    let totalDocuments = 0;
    let documentsWithDuplicates = 0;
    let totalDuplicatesRemoved = 0;
    let lastProgressLog = Date.now();
    const progressInterval = 5000; // Log progress every 5 seconds
    
    log('📥 Fetching first batch from cursor...');
    let cursorCheckStart = Date.now();

    while (await cursor.hasNext()) {
      const cursorCheckTime = Date.now() - cursorCheckStart;
      if (cursorCheckTime > 1000) {
        log(`⚠️  Slow cursor.hasNext(): ${formatElapsedTime(cursorCheckTime)}`);
      }
      
      const fetchStart = Date.now();
      const doc = await cursor.next();
      const fetchTime = Date.now() - fetchStart;
      if (fetchTime > 1000) {
        log(`⚠️  Slow cursor.next(): ${formatElapsedTime(fetchTime)}`);
      }
      
      totalDocuments++;
      
      // Log first few documents to confirm loop is running
      if (totalDocuments <= 3) {
        log(`📄 Processing document #${totalDocuments}: ${doc._id}`);
      }
      
      // Also log every 100 documents as a heartbeat
      if (totalDocuments % 100 === 0) {
        log(`💓 Heartbeat: Processed ${totalDocuments} documents`);
      }

      // Log progress periodically
      const now = Date.now();
      if (now - lastProgressLog >= progressInterval) {
        const percent = ((totalDocuments / totalCount) * 100).toFixed(1);
        const elapsed = formatElapsedTime(now - scanStart);
        const rate = totalDocuments > 0 ? (totalDocuments / ((now - scanStart) / 1000)).toFixed(1) : '0';
        log(`⏳ Progress: ${totalDocuments}/${totalCount} (${percent}%) | Elapsed: ${elapsed} | Rate: ${rate} docs/sec | Duplicates found: ${totalDuplicatesRemoved}`);
        lastProgressLog = now;
      }
      
      // Reset timer for next cursor check
      cursorCheckStart = Date.now();

      if (!doc.messages || !Array.isArray(doc.messages)) {
        continue;
      }

      const originalCount = doc.messages.length;
      
      // Log for documents with many messages (potential slow processing)
      if (originalCount > 1000) {
        log(`📝 Processing large document ${doc._id} with ${originalCount} messages...`);
      }

      // Deduplicate messages
      const seenKeys = new Set();
      const deduplicatedMessages = [];
      let duplicatesInDoc = 0;

      for (const msg of doc.messages) {
        // Create a unique key for each message
        let key;

        if (msg.type === 'image' || msg.type === 'mergeFace' || msg.type === 'bot-image-slider') {
          // For image messages, use combination of identifiers
          if (msg.batchId && msg.batchIndex !== undefined && msg.batchIndex !== null) {
            // Batch messages: unique by batchId + batchIndex
            key = `batch:${msg.batchId}:${msg.batchIndex}`;
          } else if (msg.mergeId) {
            // Merge messages: unique by mergeId
            key = `merge:${msg.mergeId}`;
          } else if (msg.imageId) {
            // Regular image messages: unique by imageId
            key = `image:${msg.imageId}`;
          } else if (msg.imageUrl) {
            // Fallback to imageUrl if no other identifier
            key = `url:${msg.imageUrl}`;
          } else {
            // No identifier, keep the message (shouldn't happen for valid messages)
            deduplicatedMessages.push(msg);
            continue;
          }
        } else {
          // Non-image messages: always keep
          deduplicatedMessages.push(msg);
          continue;
        }

        // Check if we've seen this key before
        if (seenKeys.has(key)) {
          duplicatesInDoc++;
          if (isDryRun) {
            console.log(`  [DUPLICATE] ${key}`);
          }
        } else {
          seenKeys.add(key);
          deduplicatedMessages.push(msg);
        }
      }

      if (duplicatesInDoc > 0) {
        documentsWithDuplicates++;
        totalDuplicatesRemoved += duplicatesInDoc;

        log(`📄 Document: ${doc._id}`);
        console.log(`   Original messages: ${originalCount}`);
        console.log(`   Duplicates found: ${duplicatesInDoc}`);
        console.log(`   After cleanup: ${deduplicatedMessages.length}`);

        if (!isDryRun) {
          // Update the document with deduplicated messages
          const updateStart = Date.now();
          const result = await userChatCollection.updateOne(
            { _id: doc._id },
            {
              $set: {
                messages: deduplicatedMessages,
                updatedAt: new Date()
              }
            }
          );

          if (result.modifiedCount > 0) {
            console.log(`   ✅ Cleaned successfully (${formatElapsedTime(Date.now() - updateStart)})`);
          } else {
            console.log(`   ⚠️  No changes made`);
          }
        }
      }
    }

    const scanElapsed = formatElapsedTime(Date.now() - scanStart);
    log(`\n✅ Document scan complete (${scanElapsed})`);

    // Summary
    const totalElapsed = formatElapsedTime(Date.now() - startTime);
    console.log('\n' + '='.repeat(60));
    console.log('📊 CLEANUP SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total documents scanned: ${totalDocuments}`);
    console.log(`Documents with duplicates: ${documentsWithDuplicates}`);
    console.log(`Total duplicates ${isDryRun ? 'found' : 'removed'}: ${totalDuplicatesRemoved}`);
    console.log(`Total time elapsed: ${totalElapsed}`);
    console.log(`Average rate: ${(totalDocuments / ((Date.now() - startTime) / 1000)).toFixed(1)} docs/sec`);

    if (isDryRun && totalDuplicatesRemoved > 0) {
      console.log('\n💡 Run without --dry-run to apply changes');
    }

  } catch (error) {
    log(`❌ Error: ${error.message}`);
    console.error('Stack trace:', error.stack);
  } finally {
    log('📡 Disconnecting from MongoDB...');
    await client.close();
    log(`✅ Disconnected from MongoDB | Total runtime: ${formatElapsedTime(Date.now() - startTime)}`);
  }
}

main();
