const { Log } = require('../logging_middleware');

const DEPOTS_API = 'http://20.207.122.201/evaluation-service/depots';
const VEHICLES_API = 'http://20.207.122.201/evaluation-service/vehicles';
const TOKEN = process.env.BEARER_TOKEN;

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
        await Log('backend', 'error', 'vehicle_maintence_scheduler', `Fetch failed for ${url}: ${error.message}`);
        throw error;
    }
}

function solveKnapsack(vehicles, capacity) {
    const n = vehicles.length;
    const dp = Array(n + 1).fill(null).map(() => Array(capacity + 1).fill(0));

    for (let i = 1; i <= n; i++) {
        const weight = vehicles[i - 1].Duration;
        const value = vehicles[i - 1].Impact;
        for (let w = 1; w <= capacity; w++) {
            if (weight <= w) {
                dp[i][w] = Math.max(dp[i - 1][w], dp[i - 1][w - weight] + value);
            } else {
                dp[i][w] = dp[i - 1][w];
            }
        }
    }

    let res = dp[n][capacity];
    let w = capacity;
    const selectedTasks = [];

    for (let i = n; i > 0 && res > 0; i--) {
        if (res !== dp[i - 1][w]) {
            selectedTasks.push(vehicles[i - 1].TaskID);
            res -= vehicles[i - 1].Impact;
            w -= vehicles[i - 1].Duration;
        }
    }

    return {
        maxImpact: dp[n][capacity],
        selectedTasks: selectedTasks.reverse()
    };
}

async function main() {
    await Log('backend', 'info', 'vehicle_maintence_scheduler', 'Starting vehicle scheduler');

    try {
        const depotsData = await fetchAPI(DEPOTS_API);
        const vehiclesData = await fetchAPI(VEHICLES_API);

        const depots = depotsData.depots || [];
        const vehicles = vehiclesData.vehicles || [];

        await Log('backend', 'info', 'vehicle_maintence_scheduler', `Fetched ${depots.length} depots and ${vehicles.length} vehicles`);

        for (const depot of depots) {
            const capacity = depot.MechanicHours;
            const result = solveKnapsack(vehicles, capacity);
            console.log(`Depot ID: ${depot.ID}, Capacity: ${capacity}`);
            console.log(`Max Impact: ${result.maxImpact}`);
            console.log(`Selected Tasks:`, result.selectedTasks);
            
            
            await Log('backend', 'info', 'vehicle_maintence_scheduler', `Processed Depot ${depot.ID} with max impact ${result.maxImpact}`);
        }

    } catch (error) {
        console.error('Error:', error.message);
        await Log('backend', 'error', 'vehicle_maintence_scheduler', `Main process failed: ${error.message}`);
    }
}

main();
