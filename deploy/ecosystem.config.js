module.exports = {
    apps: [{
        name: 'link-rotator',
        script: './src/server.js',
        instances: 2,
        exec_mode: 'cluster',
        env: {
            NODE_ENV: 'production'
        },
        error_file: './logs/error.log',
        out_file: './logs/out.log',
        log_file: './logs/combined.log',
        time: true,
        max_memory_restart: '500M',
        exp_backoff_restart_delay: 100,
        watch: false,
        ignore_watch: ['node_modules', 'logs', 'frontend'],
        merge_logs: true,
        autorestart: true,
        max_restarts: 10,
        min_uptime: '10s'
    }]
};