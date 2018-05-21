class Env {
    constructor(env, port) {
        this.env = env;
        this.port = port;
    }

    add(config, resource) {
        let env = this.env;
        config.Env = [];
        Object.keys(env).forEach(function (key) {
            config.Env.push(key + '=' + env[key]);
        });
        config.Env.push('MEMORY_AVAILABLE=' + (resource.size.memory / Math.pow(1024, 2)));

        config.Env.push('WEB_MEMORY=' + ((resource.size.memor / (typeof resource.cpuset === 'number'
            ? resource.cpuset : resource.cpuset.split(',').length)) / 1048576));

        config.Env.push('WEB_CONCURRENCY=' + (typeof resource.cpuset === 'number'
            ? resource.cpuset : resource.cpuset.split(',').length));
    }

    remove() {

    }

}

module.exports = Env;