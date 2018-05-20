class Volume {
    constructor(volumes, port) {
        this.volumes = volumes;
        this.port = port;
    }

    add(config) {
        let volumes = this.volumes;
        config.Volumes = {};
        config.Binds = [];
        Object.keys(volumes).forEach(function (key) {
            config.Volumes[key] = {};
            config.Binds.push(key + ':' + volumes[key]);
        });
    }

    remove() {

    }

}

module.exports = Volume;