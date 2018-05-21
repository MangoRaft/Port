const events = require('events');
const os = require('os');
const Docker = require('dockerode');
const fs = require('fs');
require('colors');


const Container = require('./container');
const Resource = require('./manager/resource');
const Volume = require('./manager/volume');
const Env = require('./manager/env');

const DEFAULT_MAX_CLIENTS = 1024;

const states = {
    'INITIALIZING': 'INITIALIZING'.yellow,
    'STARTING': 'STARTING'.blue,
    'RUNNING': 'RUNNING'.green,
    'STOPPING': 'STOPPING'.white,
    'STOPPED': 'STOPPED'.gray,
    'CRASHED': 'CRASHED'.red
};

class Port extends events.EventEmitter {
    constructor(options) {
        super(options);

        this.options = options;

        this.name = options.name;
        this.address = options.address;
        this.environment = options.environment || 'development';
        this.shuttingDown = false;

        this.maxMemory = options.maxMemory;

        this.multiTenant = options.multiTenant;
        this.maxClients = this.multiTenant ? DEFAULT_MAX_CLIENTS : 1;

        this.reservedMemory = 0;
        this.usagedMemory = 0;

        this.cores = os.cpus().length;

        this.coresUsed = [];

        for (var i = 0; i < this.cores; i++) {
            this.coresUsed[i] = 0;
        }

        this.containers = {};
        this.docker = null;


    }

    container(id) {
        if (!id) {
            return this.containers;
        }
        return this.containers[id];
    }

    run() {
        let options = {};

        if (this.options.docker.socket) {
            let socket = this.options.docker.socket || '/var/run/docker.sock';
            let stats = fs.statSync(socket);

            if (!stats.isSocket()) {
                throw new Error("Are you sure the docker is running?");
            }
            options.socketPath = socket;
        } else if (this.options.docker.host && this.options.docker.port) {
            options.host = this.options.docker.host;
            options.port = this.options.docker.port;
        }

        this.docker = new Docker(options);

        this.attachEvents();

        this.emit('run');
    }

    start(options) {


        let _options = {
            node: options.node,
            logs: options.logs,
            address: this.address,
            logSession: options.logSession,
            metricSession: options.metricSession,
            stats: !!options.stats,
            shortLived: options.shortLived,
            name: options.name,
            index: options.index,
            uid: options.uid,
            source: options.source,
            channel: options.channel,
            process: options.process,
            docker: this.docker,
            auth: options.auth,
            exclude: options.exclude,
            config: {
                "name": options.uid,
                "Hostname": options.hostname || options.name + '.' + options.index,

                "ReadonlyRootfs": true,
                "Tty": false,
                "Image": options.image,
                "Volumes": {},
                "ExposedPorts": {},
                "HostConfig": {
                    "PortBindings": {}
                },
                "Dns": options.dns || ["8.8.8.8"]
            }
        };

        if (options.user) {
            _options.config.User = options.user;
        }


        if (options.size) {
            let resource = new Resource(options.size, this)
            _options.resource = resource;
            resource.add(_options.config.HostConfig)
        }
        if (options.volumes) {
            let volume = new Volume(options.volumes, this);
            _options.volume = volume;
            volume.add(_options.config)
        }
        if (options.env) {
            let env = new Env(options.env, this);
            _options.env = env;
            env.add(_options.config, _options.resource)
        }


        if (options.cmd) {
            _options.config.Cmd = typeof options.cmd === 'string' ? options.cmd.split(' ') : options.cmd
        }

        options.ports.forEach(function (exposedPort) {
            _options.config.ExposedPorts[exposedPort] = {};
            _options.config.HostConfig.PortBindings[exposedPort] = [{
                "HostPort": "0"
            }];
        });
        return this.startContainer(_options)

    }

    startContainer(options) {
        let self = this;

        let container = new Container(options);
        self.containers[container.info.uid] = container;

        container.on('error', function (error) {
            self.emit('error', error);
        });
        container.once('wait', function (data) {
            self.emit('wait', container, data);
        });
        container.once('STOPPED', function () {
            if (container.resource)
                container.resource.remove();
            if (container.volume)
                container.volume.remove();
            self.emit('STOPPED', container);
            delete self.containers[container.id];
            delete self.containers[container.info.uid];
        });
        container.once('CRASHED', function () {
            if (container.resource)
                container.resource.remove();
            if (container.volume)
                container.volume.remove();
            self.emit('CRASHED', container);
            delete self.containers[container.id];
            delete self.containers[container.info.uid];
        });
        container.on('stats', function (stats) {
            self.emit('stats', stats, container);
        });

        container.states.forEach(function (state) {
            container.on(state, function () {
                console.log('State changed to: ' + states[state] + '	' + options.config.Hostname);
                if (state !== 'STARTING')
                    self.emit('state', state, container);
            });
        });


        return new Promise(function (resolve, reject) {
            process.nextTick(async function () {


                try {
                    await container.start();
                    self.containers[container.id] = container;
                    delete self.containers[container.info.uid];
                    resolve(container)
                } catch (err) {
                    return reject(err);
                }
            });
        });
    }

    stop(id) {
        let container = this.container(id);

        if (!container) {
            return Promise.reject(new Error('no container found'));
        }

        if (['STOPPING', 'STOPPED', 'CRASHED', 'DELETED'].indexOf(container.state) !== -1) {
            return Promise.resolve();
        }

        return container.stop(true);
    }

    destroy() {
        let self = this;
        return Promise.all(Object.keys(this.container()).map(function (id) {
            return self.stop(id);
        }))
    }

    attachEvents() {
        let self = this;
        this.docker.getEvents({
            //
        }, function (err, stream) {
            if (err)
                return self.emit('error', err);
            stream.on('data', function (data) {
                let json;
                try {
                    json = JSON.parse(data.toString());
                } catch (e) {
                    //ignore
                    return;
                }
                self.emit('docker ' + json.status, json);
            });
        });
    }

    avalibale() {
        return {
            memory: {
                used: this.usagedMemory / Math.pow(1024, 2),
                reserved: this.reservedMemory / Math.pow(1024, 2),
                avalibale: (this.maxMemory - (this.usagedMemory + this.reservedMemory)) / Math.pow(1024, 2)
            },
            cores: {
                count: this.cores,
                used: this.coresUsed,
                avalibale: (this.cores * 1000) - this.coresUsed.reduce((accumulator, currentValue) => accumulator + currentValue)
            }
        };
    }

}

module.exports = Port;

