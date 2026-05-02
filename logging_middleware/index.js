async function Log(stack, level, pkg, message) {
    const url = "http://20.207.122.201/evaluation-service/log";
    try {
        await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.BEARER_TOKEN}`
            },
            body: JSON.stringify({ stack, level, package: pkg, message })
        });
    } catch (e) {}
}

module.exports = { Log };
