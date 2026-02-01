# Duplicate Messages Issue - Debug Guide

## Issue Summary

**Problem:** Thousands of duplicate image messages appearing in `userChat.messages` array, particularly for auto-merged face images (`type: "mergeFace"`).

**Symptoms:**
- Chat messages array grows exponentially (e.g., 1648 messages with 1573 duplicates)
- Duplicates have identical `mergeId`, `batchId`, `batchIndex` values
- Most duplicates are `type: "mergeFace"` with `isMerged: true`
- Issue seems to occur after server restarts or during high load

**Example duplicate message:**
```javascript
{
  batchId: "auto_1769914068902_bdpryu",
  batchIndex: 0,
  batchSize: 1,
  isMerged: true,
  mergeId: "697ebf17b2521101e66a4444",
  type: "mergeFace",
  imageUrl: "https://..._merged-face-..."
}
```

---

## Root Cause Analysis

### The Core Problem: Inconsistent Deduplication Keys

The duplicate messages were caused by **inconsistent deduplication logic** across multiple code paths that add messages to `userChat.messages`.

#### Key Issue #1: Wrong Deduplication Key for Merged Images

In `addImageMessageToChatHelper()` (imagen.js), the deduplication logic was:

```javascript
// OLD CODE - PROBLEMATIC
if (batchId && batchIndex !== null) {
  // Check by batchId + batchIndex
  existingMessage = chatDoc.messages.find(m =>
    m.batchId === batchId && m.batchIndex === batchIndex
  );
} else {
  // Check by imageId
  existingMessage = chatDoc.messages.find(m => m.imageId === imageIdStr);
}
```

**Problem:** For merged images, `mergeId` is the unique identifier, NOT `batchId+batchIndex`. If the same merged image was processed twice with different batch metadata (or if batch metadata changed), duplicates would be created.

#### Key Issue #2: Race Conditions in Non-Atomic Checks

In `addMergeFaceMessageToChat()` (merge-face-utils.js):

```javascript
// OLD CODE - RACE CONDITION
const existingMessage = await collectionUserChat.findOne({
  _id: new ObjectId(userChatId),
  'messages.mergeId': mergeId
});

if (existingMessage) {
  return; // Skip
}

// GAP HERE - Another process can insert between findOne and updateOne!

await collectionUserChat.updateOne(
  { _id: new ObjectId(userChatId) },
  { $push: { messages: assistantMessage } }
);
```

#### Key Issue #3: Multiple Code Paths Adding Messages

Messages can be added from multiple sources:
1. `addImageMessageToChatHelper()` - Main path for generated images
2. `addMergeFaceMessageToChat()` - Manual merge face API
3. `saveImageToDB()` - When image exists in gallery but message missing
4. `handleGalleryImage()` - Adding gallery images to chat
5. `appendMessageToUserChat()` - General utility function
6. `saveVideoToDB()` - Video messages

Each had different (or missing) deduplication logic.

---

## The Fix

### Fix #1: Use `mergeId` as Primary Key for Merged Images

In `addImageMessageToChatHelper()`:

```javascript
// NEW CODE - FIXED
// Lock key now uses mergeId for merged images
let lockKey;
if (isMerged && mergeId) {
  lockKey = `msg:${userChatId}:merge:${mergeId}`;
} else if (batchId && batchIndex !== null) {
  lockKey = `msg:${userChatId}:batch:${batchId}:${batchIndex}`;
} else {
  lockKey = `msg:${userChatId}:image:${imageIdStr}`;
}

// Early check now includes mergeId
if (isMerged && mergeId) {
  existingMessage = chatDoc.messages.find(m => m.mergeId === mergeId);
  if (existingMessage) return true; // Skip duplicate
}

// Atomic filter now uses mergeId for merged images
if (isMerged && mergeId) {
  atomicFilter = {
    userId: new ObjectId(userId),
    _id: new ObjectId(userChatId),
    'messages.mergeId': { $ne: mergeId }  // Only insert if mergeId doesn't exist
  };
}
```

### Fix #2: Atomic Operations Everywhere

All message insertion points now use atomic MongoDB operations:

```javascript
// NEW CODE - ATOMIC CHECK + INSERT
const updateResult = await collectionUserChat.updateOne(
  { 
    _id: new ObjectId(userChatId),
    'messages.mergeId': { $ne: mergeId }  // Condition in the filter
  },
  {
    $push: { messages: assistantMessage },
    $set: { updatedAt: new Date() }
  }
);

if (updateResult.matchedCount === 0) {
  // Document didn't match = mergeId already exists
  console.log('Duplicate skipped');
}
```

---

## Files Modified

| File | Function | Change |
|------|----------|--------|
| `models/imagen.js` | `addImageMessageToChatHelper()` | Use `mergeId` as primary key for merged images |
| `models/imagen.js` | `saveImageToDB()` | Check `mergeId` instead of `batchId+batchIndex` for merged images |
| `models/merge-face-utils.js` | `addMergeFaceMessageToChat()` | Atomic operation instead of check-then-add |
| `models/chat-completion-utils.js` | `handleGalleryImage()` | Atomic operation + fix double push bug |
| `models/gallery-utils.js` | `appendMessageToUserChat()` | Atomic operation with `mergeId`/`imageId` check |
| `models/img2video-utils.js` | `saveVideoToDB()` | Atomic operation with `videoId` check |

---

## Cleanup Script

To clean up existing duplicates, run:

```bash
node cleanup-duplicate-messages.js
```

Or for a dry run first:

```bash
node cleanup-duplicate-messages.js --dry-run
```

The script deduplicates by:
1. `batchId + batchIndex` for batch messages
2. `mergeId` for merge messages
3. `imageId` for regular images
4. `imageUrl` as fallback

---

## Future Debugging

### If Duplicates Still Appear

1. **Check the logs for which code path is adding messages:**
   - Look for `[addImageMessageToChatHelper]` logs
   - Look for `[addMergeFaceMessageToChat]` logs
   - Look for `[saveImageToDB]` logs

2. **Verify the lock is working:**
   ```
   🔒 [addImageMessageToChatHelper] Lock already exists for msg:XXX:merge:YYY, skipping duplicate
   ```
   If you DON'T see this when duplicates are created, the lock key might be different between calls.

3. **Verify atomic check is working:**
   ```
   💾 [addImageMessageToChatHelper] Message already exists (atomic check) for mergeId=XXX, skipping duplicate
   ```
   If you DON'T see this, check if the `mergeId` values are actually the same.

4. **Check for new code paths:**
   Search for all places that add messages:
   ```bash
   grep -r "\$push.*messages" models/ routes/
   ```

5. **Check for timing issues:**
   - Webhook + polling processing same task
   - Task recovery on server restart
   - Multiple Novita webhook retries

### Common Patterns to Watch For

| Pattern | Risk | Solution |
|---------|------|----------|
| `findOne` then `updateOne` | Race condition | Use atomic filter in `updateOne` |
| Check by `batchId+batchIndex` for merged images | Wrong key | Always check `mergeId` first for merged images |
| No duplicate check at all | Duplicates guaranteed | Add atomic filter |
| In-memory locks only | Doesn't work across workers | Use MongoDB locks collection |

---

## Database Collections Involved

- **`userChat`** - Contains `messages` array where duplicates appear
- **`messageLocks`** - Distributed locks for message insertion (TTL: 60s)
- **`gallery`** - Source of truth for images, referenced by messages
- **`mergedResults`** - Cache for merge operations (prevents duplicate API calls)
- **`mergeLocks`** - Locks for merge operations

---

## Related Configuration

### Task Recovery (Disabled)

In `models/cronManager.js`, task recovery is disabled to prevent duplicate processing:

```javascript
// Disable to see if duplicates disappear
//await runStartupTaskRecovery(fastify);
```

If re-enabling, ensure `checkTaskStatus()` properly handles `fromCache: true` flag.

### Polling vs Webhooks

The system uses webhooks for task completion. Polling (`pollSequentialTasksWithFallback`) is a fallback that:
1. Waits 10 seconds before starting (gives webhooks time to arrive)
2. Checks `webhookProcessed` and `completionNotificationSent` before processing
3. Skips `handleTaskCompletion()` if `fromCache: true`

---

## Version History

| Date | Change |
|------|--------|
| 2026-02-01 | Initial fix: Use `mergeId` as primary key, atomic operations everywhere |
