const { Log } = require('../logging_middleware');

const NOTIFICATIONS_API = 'http://20.207.122.201/evaluation-service/notifications';
const TOKEN = process.env.BEARER_TOKEN;

const TYPE_WEIGHTS = {
    'Placement': 3,
    'Result': 2,
    'Event': 1
};

async function fetchAPI(url) {
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        await Log('backend', 'error', 'notification_app_be', `Fetch failed for ${url}: ${error.message}`);
        throw error;
    }
}

function getTopNNotifications(notifications, n = 10) {
    notifications.sort((a, b) => {
        const weightA = TYPE_WEIGHTS[a.Type] || 0;
        const weightB = TYPE_WEIGHTS[b.Type] || 0;

        if (weightA !== weightB) {
            return weightB - weightA; 
        }

        const timeA = new Date(a.Timestamp).getTime();
        const timeB = new Date(b.Timestamp).getTime();
        return timeB - timeA; 
    });

    return notifications.slice(0, n);
}

async function main() {
    await Log('backend', 'info', 'notification_app_be', 'Starting top 10 notification fetch');

    try {
        const data = await fetchAPI(NOTIFICATIONS_API);
        const notifications = data.notifications || [];

        await Log('backend', 'info', 'notification_app_be', `Fetched ${notifications.length} notifications`);

        const top10 = getTopNNotifications(notifications, 10);

        console.log(`Top 10 Notifications:`);
        top10.forEach((notif, index) => {
            console.log(`${index + 1}. [${notif.Type}] ${notif.Message} (${notif.Timestamp})`);
        });

        await Log('backend', 'info', 'notification_app_be', `Successfully calculated top 10 notifications`);
    } catch (error) {
        console.error('Error:', error.message);
        await Log('backend', 'error', 'notification_app_be', `Main process failed: ${error.message}`);
    }
}

main();
