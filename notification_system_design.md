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

# Stage 4

## Performance Improvement Strategy
Currently, notifications are fetched on each page load. This synchronous polling overwhelms the database.

**Suggested Solutions:**

1. **Client-Side State Management + WebSockets (Push Model):**
   Instead of fetching on every page load, the frontend fetches the initial state *once* upon login. As established in Stage 1, we use WebSockets. New notifications are pushed to the client in real-time. The frontend updates its local state globally (e.g., using Redux or Context API), eliminating the need for subsequent DB fetches during page navigation.
2. **Read-Through Caching (Redis/Memcached):**
   If we must rely on REST API fetches, we should cache the user's unread notifications in Redis. The DB is only queried upon a cache miss.

## Tradeoffs
- **WebSockets + Client State:**
  - *Pros:* Massive reduction in server read load; instant real-time UX.
  - *Cons:* High memory utilization on the server to keep WebSocket connections open; complex reconnection logic; potential missed messages on disconnects.
- **Caching (Redis):**
  - *Pros:* Extremely fast reads with minimal application code changes.
  - *Cons:* Cache invalidation complexity (when to evict/update the cache as notifications are read); adds an extra infrastructure point of failure.

# Stage 5

## Shortcomings of the Pseudocode
1. **Sequential Thread Blocking:** The loop operates synchronously. If the 3rd-party `send_email` API takes 1 second per email, sending 50,000 emails will take nearly 14 hours. 
2. **Lack of Fault Tolerance (No Retries):** If `send_email` fails for 200 students (e.g., due to network timeout or rate limiting), the script might crash or skip them entirely. There is no mechanism to track and retry *only* the failed deliveries.
3. **Tight Coupling:** The three functions (`email`, `db`, `push`) are tightly coupled. A failure in the email API shouldn't prevent saving the notification to the database or pushing it to the app.

## Redesign for Reliability and Speed
I would redesign this using an **Event-Driven Architecture** with **Message Queues** (e.g., Kafka, RabbitMQ, or AWS SQS).
When the HR clicks "Notify All", the system simply publishes an asynchronous "Broadcast Event" and immediately returns a success response to the HR. Independent decoupled worker services consume this event.

## Should saving to DB and sending email happen together?
**No.** Saving to a DB is an internal, highly predictable, and fast operation (milliseconds). Sending an email relies on a 3rd party external API, which is slower and highly prone to timeouts, rate limits, and failures. Tying them together synchronously means the slow/unreliable system will negatively bottleneck the fast/reliable system.

## Revised Pseudocode
```python
function notify_all(student_ids: array, message: string):
    # Asynchronously publish the bulk action to a message broker (e.g., Kafka/RabbitMQ)
    payload = { "student_ids": student_ids, "message": message }
    message_broker.publish(topic="notifications.broadcast", data=payload)
    return "Notification broadcast initiated"

# --- Independent Background Workers consuming the topic ---

# DB Worker
function on_broadcast_save_db(payload):
    # Batch inserts are much faster
    batch_save_to_db(payload.student_ids, payload.message) 

# Email Worker
function on_broadcast_send_email(payload):
    for student_id in payload.student_ids:
        # Enqueue individual email tasks that support Retries and Dead Letter Queue (DLQ)
        background_job_queue.enqueue(
            task=send_email_task, 
            args=(student_id, payload.message), 
            retry_policy={ "max_retries": 3, "backoff": "exponential" }
        )

# Push Notification Worker
function on_broadcast_push_app(payload):
    for student_id in payload.student_ids:
        background_job_queue.enqueue(task=push_to_app, args=(student_id, payload.message))
```

# Stage 6

## Maintaining Top 10 High Priority Notifications Efficiently

### Approach
As new notifications arrive continuously, sorting the entire dataset $O(N \log N)$ every time becomes highly inefficient as $N$ grows. 

To maintain the top $k$ (where $k=10$) notifications efficiently:

1. **Priority Queue (Min-Heap):**
   - We can maintain a Min-Heap of size $k$ for active unread notifications.
   - A custom comparator is used: `Weight (Placement=3, Result=2, Event=1)` followed by `Recency`.
   - When a new notification arrives:
     - Compare it to the root of the Min-Heap (the lowest priority item in the top 10).
     - If it's more important than the root, pop the root and push the new notification.
   - **Time Complexity:** $O(\log k)$ per new notification instead of $O(N \log N)$. Space complexity is $O(k)$.

2. **Redis Sorted Sets (Distributed Approach):**
   - If deploying at scale in a microservices environment, use a Redis Sorted Set (ZSET) per user: `user:{id}:top_notifications`.
   - The score inside the ZSET would be a composite float value combining `weight` and `timestamp`.
   - New notifications are added via `ZADD`. We keep the set size capped at $k$ by triggering a `ZREMRANGEBYRANK` to remove elements extending beyond the standard size.
   - Fetching the top 10 is an $O(1)$ operation `ZREVRANGE 0 9`.