module.exports = {
    apps: [
        {
            name: "bot",
            script: "dist/bin/index.js"
        },
        {
            name: "deploy",
            script: "dist/bin/deploy.js",
            env: {
                PORT: 8002
            }
        }
    ]
}