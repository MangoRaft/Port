class Env {
    constructor(env, port) {
        this.env = env;
        this.port = port;
    }

    add(config) {
        let env = this.env;
        config.Env = [];
        Object.keys(env).forEach(function (key) {
            config.Env.push(key + '=' + env[key]);
        });
        config.Env.push('MEMORY_AVAILABLE=' + (config.HostConfig.Memory / Math.pow(1024, 2)));

        config.Env.push('WEB_MEMORY=' + ((config.HostConfig.Memory / (typeof config.HostConfig.CpusetCpus === 'number'
            ? config.HostConfig.CpusetCpus : config.HostConfig.CpusetCpus.split(',').length)) / 1048576));

        config.Env.push('WEB_CONCURRENCY=' + (typeof config.HostConfig.CpusetCpus === 'number'
            ? config.HostConfig.CpusetCpus : config.HostConfig.CpusetCpus.split(',').length));
    }

    remove() {

    }

}

module.exports = Env;