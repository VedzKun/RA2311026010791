# Stage 1

## Core Actions
1. Fetch all notifications for a user (with pagination and filtering by read status)
2. Mark a specific notification as read
3. Mark all notifications as read

## REST API Endpoints

### 1. Fetch Notifications
**Endpoint:** `GET /api/v1/notifications`
**Headers:**
```json
{
  "Authorization": "Bearer <token>"
}
```

**Query Parameters:**
- `status`: `unread` | `all`

**Response (200 OK):**
```json
{
  "data": [
    {
      "id": "d146095a-0d86-4a34-9e69-3900a14576bc",
      "type": "Result",
      "message": "mid-sem",
      "isRead": false,
      "timestamp": "2026-04-22T17:51:30Z"
    }
  ]
}
```

### 2. Mark Notification as Read
**Endpoint:** `PATCH /api/v1/notifications/{id}/read`
**Headers:**
```json
{
  "Authorization": "Bearer <token>"
}
```

**Response (200 OK):**
```json
{
  "message": "Marked as read"
}
```

### 3. Mark All Notifications as Read
**Endpoint:** `PATCH /api/v1/notifications/read-all`
**Headers:**
```json
{
  "Authorization": "Bearer <token>"
}
```

**Response (200 OK):**
```json
{
  "message": "All marked as read"
}
```

## Real-Time Notifications
Use WebSockets for real-time delivery.

**Connection Endpoint:** `wss://api.domain.com/v1/notifications/stream?token=<token>`

**Server to Client Payload:**
```json
{
  "type": "NEW_NOTIFICATION",
  "data": {
    "id": "b283218f-ea5a-4b7c-93a9-1f2f240d64b0",
    "type": "Placement",
    "message": "CSX Corporation hiring",
    "timestamp": "2026-04-22T17:51:30Z"
  }
}
```

# Stage 2

## Persistent Storage
**Choice:** PostgreSQL
**Reason:** Notifications require structured data with relationships (e.g., student IDs), and ACID compliance ensures reliable read/write operations when marking notifications as read. PostgreSQL also supports JSONB if we need flexible payloads in the future and handles indexing well for querying.

## Database Schema
```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY,
    student_id VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_student_status ON notifications(student_id, is_read);
```

## Scaling the Database
**Problems with Data Volume:** 
- Slower read queries due to large table scans.
- Increased storage costs and slower write performance.

**Solutions:**
1. **Indexing:** Add composite indexes on `student_id` and `is_read` to speed up fetching unread notifications.
2. **Partitioning:** Partition the table by `created_at` (e.g., monthly partitions) so queries on recent notifications scan less data.
3. **Data Archiving/TTL:** Move notifications older than a certain period (e.g., 6 months) to cold storage or delete them.
4. **Caching:** Use Redis to cache the unread notification count and the most recent notifications for active users.

## Queries

**1. Fetch unread notifications for a user:**
```sql
SELECT id, type, message, is_read, created_at 
FROM notifications 
WHERE student_id = $1 AND is_read = false 
ORDER BY created_at DESC 
LIMIT 50;
```

**2. Mark a notification as read:**
```sql
UPDATE notifications 
SET is_read = true 
WHERE id = $1 AND student_id = $2;
```

**3. Mark all notifications as read:**
```sql
UPDATE notifications 
SET is_read = true 
WHERE student_id = $1 AND is_read = false;
```

# Stage 3

## Query Evaluation

### Is the query accurate?
Yes, the query accurately fetches all unread notifications for a specific student (`studentID = 1042 AND isRead = false`).

### Why is this slow?
The query is slow because without proper indexing on the `notifications` table, the database must perform a **Full Table Scan**. It has to check every single row among the 5,000,000 records to find matching `studentID` and `isRead` combinations. Sorting by `createdAt DESC` adds an additional costly memory sort operation.

### Recommended Changes & Computation Cost
**Change:** Add a composite index on `(studentID, isRead, createdAt DESC)`.
**Likely Computation Cost:** With the index, the database can perform an **Index Seek** directly to the relevant student's unread notifications and the results will already be pre-sorted. The time complexity changes from $O(N)$ (where N is 5 million) to $O(\log N + K)$ (where K is the number of unread notifications for that student). 

### Critique of colleague's advice (Adding indexes on every column)
**Is it effective?** No, it is a bad practice.
**Why/Why not?** 
1. **Storage Overhead:** Indexes consume disk space. Indexing every column will massively bloat the database size.
2. **Write Penalty:** Every `INSERT`, `UPDATE`, or `DELETE` operation will require updating all those indexes, severely degrading write performance.

### Query for Placement Notifications in the last 7 days
```sql
SELECT * FROM notifications 
WHERE notification_type = 'Placement' 
AND created_at >= NOW() - INTERVAL '7 days'; 
```